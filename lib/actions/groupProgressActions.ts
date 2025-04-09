"use server"
import { ID, Query, Databases, Models, Client } from "node-appwrite";
import { createAdminClient, createSessionClient } from "../appwrite";
import { appwriteConfig } from "../appwrite/config";


export interface ExerciseState {
    currentBPM: number;
    accuracyLastAttempt: number | null;
    isGraduated: boolean;
    unlocked: boolean
}

export interface GroupProgressDocument extends Models.Document {
    userID: string;
    context: string;
    groupID: string;
    level: number;
    exerciseStates: string;
    isActive: boolean;
    lastPracticed: string
}
const databaseId = appwriteConfig.databaseId
const groupProgressCollectionId = appwriteConfig.groupProgressCollectionId


function safeParseExerciseStates(jsonString: string | null | undefined): { [key: string]: ExerciseState } {
    if (!jsonString) {
        console.log("safeParseExerciseStates: Input is null or empty, returning {}.");
        return {};
    }
    try {
        const parsed = JSON.parse(jsonString);
        console.log("safeParseExerciseStates: JSON.parse successful. Type:", typeof parsed, "Value:", parsed);
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed;
        } else {
            console.warn("safeParseExerciseStates: Parsed data is not a non-null object. Type:", typeof parsed);
            return {};
        }
    } catch (e) {
        console.error("safeParseExerciseStates: Error during JSON.parse:", e, "Input string was:", jsonString);
        return {};
    }
}

export async function getGroupProgress(
    userID: string,
    context: string,
    groupID: string,
): Promise<GroupProgressDocument | null> {
    try {
        const appwriteServices = await createAdminClient();
        const databases = appwriteServices.databases

        const queries = [
            Query.equal("userID", userID),
            Query.equal("context", context),
            Query.equal("groupID", groupID),
            Query.limit(1)
        ];

        const response = await databases.listDocuments<GroupProgressDocument>
            (databaseId, groupProgressCollectionId, queries)

        if (response.total > 0) {
            return response.documents[0]
        } else {
            console.log("ejercicio no encontrado para", { userID, context, groupID })
            return null
        }
    } catch (error) {
        console.error("Error fetching ExerciseState:", error);
        throw new Error(`Failed to get ExerciseState: ${error instanceof Error ? error.message : String(error)}`)
    }
}

export async function getGroupProgressParsed(
    userID: string,
    context: string,
    groupID: string
): Promise<(Omit<GroupProgressDocument, 'exerciseStates'> & { exerciseStates: { [key: string]: ExerciseState } }) | null> {
    const rawDoc = await getGroupProgress(userID, context, groupID)
    if (!rawDoc) {
        return null
    }
    const parsedStates = safeParseExerciseStates(rawDoc.exerciseStates)
    return {
        ...rawDoc,
        exerciseStates: parsedStates
    }
}
export async function createGroupProgress(
    userID: string,
    context: string,
    groupID: string,
    level: number
): Promise<GroupProgressDocument> {

    try {
        const adminClient = await createAdminClient()
        const databases = adminClient.databases

        const initialExerciseStatesObject: { [melodyLength: string]: ExerciseState } = {
            "2": { currentBPM: 60, accuracyLastAttempt: null, isGraduated: false, unlocked: true }
        }

        const initialExerciseStatesString = JSON.stringify(initialExerciseStatesObject)
        console.log("DEBUG: String being saved by createGroupProgress:", initialExerciseStatesString);
        const newDocumentData = {
            userID,
            context,
            groupID,
            level,
            exerciseStates: initialExerciseStatesString,
            isActive: true,
            lastPracticed: new Date().toISOString()
        };
        console.log("DEBUG createGroupProgress: Saving data:", newDocumentData);
        console.log("DEBUG createGroupProgress: Type of exerciseStates being saved:", typeof newDocumentData.exerciseStates);
        const newDocument = await databases.createDocument<GroupProgressDocument>(
            databaseId,
            groupProgressCollectionId,
            ID.unique(),
            newDocumentData
        )
        return newDocument
    } catch (error) {
        console.error("Error creating GroupProgress:", error);
        throw new Error(`Failed to create GroupProgress: ${error instanceof Error ? error.message : String(error)}`)
    }
}
export async function updateGroupProgress(
    documentId: string,
    updatedData: Partial<Omit<GroupProgressDocument,
        keyof Models.Document | '$id' | '$collectionId' | '$databaseId' | '$createdAt' | '$updatedAt' | '$permissions' | 'exerciseStates'>
        & { exerciseStates?: { [key: string]: ExerciseState } }>
): Promise<GroupProgressDocument> {
    try {
        const adminClient = await createAdminClient()
        const databases = adminClient.databases

        const dataToUpdate: { [key: string]: any } = { ...updatedData }

        if (updatedData.exerciseStates) {
            dataToUpdate.exerciseStates = JSON.stringify(updatedData.exerciseStates)
        } else if (updatedData.hasOwnProperty('exerciseStates') && updatedData.exerciseStates === undefined) {

            delete dataToUpdate.exerciseStates;
        }


        if (Object.keys(dataToUpdate).length === 0) {
            console.log("No hay datos para actualizar. Returning current state might be needed or throw error.");

            const currentDoc = await databases.getDocument<GroupProgressDocument>(databaseId, groupProgressCollectionId, documentId);
            return currentDoc;

        }

        const updatedDocument = await databases.updateDocument<GroupProgressDocument>(
            databaseId,
            groupProgressCollectionId,
            documentId,
            dataToUpdate
        )

        return updatedDocument
    } catch (error) {
        console.error("Error updating GroupProgress:", error);
        throw new Error(`Failed to update GroupProgress: ${error instanceof Error ? error.message : String(error)}`)
    }
}
export async function handleExerciseCompletion(userId: string,
    context: string,
    groupId: string,
    melodyLength: number,
    accuracy: number) {
    try {
        const currentProgress = await getGroupProgressParsed(userId, context, groupId)
        if (!currentProgress) {
            console.error("Progress not found, cannot update.");
            throw new Error("Progress document not found for update.");
        }
        const exerciseKey = String(melodyLength);
        console.log("DEBUG: Accessing state with key:", exerciseKey, " (melodyLength:", melodyLength, ")")
        console.log("DEBUG: Full exerciseStates object:", currentProgress.exerciseStates);
        const currentExerciseState = currentProgress.exerciseStates[exerciseKey];
        if (!currentExerciseState) {
            console.error(`Exercise state for length ${melodyLength} not found.`);
            throw new Error(`Exercise state for length ${melodyLength} not found.`);
        }
        let newBPM = currentExerciseState.currentBPM
        if (accuracy >= 0.8 && newBPM < 180) {
            newBPM = Math.min(currentExerciseState.currentBPM + 5, 180)
        }
        const updatedExerciseStates = {
            ...currentProgress.exerciseStates,
            [exerciseKey]: {
                ...currentExerciseState,
                currentBPM: newBPM,
                accuracyLastAttempt: accuracy,
            }
        }
        const updatedData = {
            exerciseStates: updatedExerciseStates,
            lastPracticed: new Date().toISOString()
        }
        console.log("DEBUG handleExerciseCompletion: Data BEFORE calling updateGroupProgress:", updatedData);
        console.log("DEBUG handleExerciseCompletion: Type of exerciseStates in updatedData:", typeof updatedData.exerciseStates); 
        if(updatedData.exerciseStates) console.log("DEBUG handleExerciseCompletion: exerciseStates OBJECT:", updatedData.exerciseStates);
        await updateGroupProgress(currentProgress.$id, updatedData)
        console.log(`Server Action: Progress updated successfully for user ${userId}, group ${groupId}. New BPM: ${newBPM}`);
        return { success: true, newBPM: newBPM }
    } catch (error) {
        console.error("Error in handleExerciseCompletion Server Action:", error);
        return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
}

export async function completeAndGetNextExercise(userId: string,
    context: string,
    completedGroupId: string,
    completedMelodyLength: number,
    accuracy: number): Promise<{
        success: true; nextExercise: {
            groupID: string;
            melodyLength: number;
            bpm: number;
        }
    } | {
        success: false;
        error: string;
    }> {
    console.log(`completeAndGetNextExercise: Starting for user ${userId} after completing group ${completedGroupId}, length ${completedMelodyLength}`);
    const updateResult = await handleExerciseCompletion(
        userId,
        context,
        completedGroupId,
        completedMelodyLength,
        accuracy
    )
    if (!updateResult.success) {
        console.error("completeAndGetNextExercise: Failed during handleExerciseCompletion. Cannot determine next exercise.");
        return { success: false, error: updateResult.error || "Unknown error" };
    }
    const nextGroupID = completedGroupId;
    const nextMelodyLength = completedMelodyLength;
    const nextBPM = updateResult.newBPM;


    if (typeof nextBPM !== 'number') {
        return { success: false, error: "BPM value is undefined" };
    }

    console.log(`completeAndGetNextExercise: Next exercise determined (MVP Logic) -> Group: ${nextGroupID}, Length: ${nextMelodyLength}, BPM: ${nextBPM}`);
    return {
        success: true,
        nextExercise: {
            groupID: nextGroupID,
            melodyLength: nextMelodyLength,
            bpm: nextBPM,
        },
    };
}

export async function getFirstExercise(
    userID: string,
    context: string,
    initialGroupID: string,
    initialLevel: number
): Promise<{
    success: true;
    exerciseParams: {
        groupID: string;
        melodyLength: number;
        bpm: number;
    }
} | {
    success: false;
    error: string;
}> {
    console.log(`getFirstExercise: Attempting to find or create progress for user ${userID}, context ${context}, group ${initialGroupID}`);
    try {
        let progressDoc = await getGroupProgressParsed(userID, context, initialGroupID);
        let exerciseBPM: number;
        const initialMelodyLength = 2;
        if (progressDoc) {
            console.log(`getFirstExercise: Found existing progress document ${progressDoc.$id}`);
            const exerciseState = progressDoc.exerciseStates[String(initialMelodyLength)];
            if (exerciseState && exerciseState.unlocked) {
                exerciseBPM = exerciseState.currentBPM;
                console.log(`getFirstExercise: Using existing BPM ${exerciseBPM} for length ${initialMelodyLength}`);
            } else {
                console.warn(`getFirstExercise: Exercise state for length ${initialMelodyLength} not found or not unlocked in existing doc. Defaulting to 60 BPM.`);
                exerciseBPM = 60;
            }
        } else {
            console.log(`getFirstExercise: No progress found. Creating new document.`);
            const newDoc = await createGroupProgress(userID, context, initialGroupID, initialLevel);
            exerciseBPM = 60;
            progressDoc = await getGroupProgressParsed(userID, context, initialGroupID);
            if (!progressDoc) throw new Error("Failed to retrieve the document immediately after creation.");
            console.log(`getFirstExercise: Created new progress document ${progressDoc.$id}. Starting BPM: ${exerciseBPM}`);
        }
        return {
            success: true,
            exerciseParams: {
                groupID: initialGroupID,
                melodyLength: initialMelodyLength,
                bpm: exerciseBPM,
            }
        };
    } catch (error) {
        console.error("Error in getFirstExercise:", error);
        return { success: false, error: error instanceof Error ? error.message : "Unknown error determining first exercise" };
    }
}