"use server";
import { ID, Query, Databases, Models } from "node-appwrite";
import { createAdminClient } from "../appwrite";
import { appwriteConfig } from "../appwrite/config";

const MAX_ACCURACY_HISTORY = 100;
const MAX_TONE_ACCURACY_HISTORY = 50;

export interface ExerciseState {
    currentBPM: number;
    accuracyLastAttempt: number | null;
    isGraduated: boolean;
    unlocked: boolean;
    accuracyHistory: number[];
}

export interface GroupProgressDocument extends Models.Document {
    userID: string;
    context: string;
    groupID: string;
    level: number;
    exerciseStates: string;
    isActive: boolean;
    lastPracticed: string;
}

export interface ToneAccuracyDocument extends Models.Document {
    userID: string;
    context: string;
    scaleDegree: string;
    accuracyHistory: number[];
    lastUpdated: string;
}

const databaseId = appwriteConfig.databaseId;
const groupProgressCollectionId = appwriteConfig.groupProgressCollectionId;
const toneAccuracyCollectionId = appwriteConfig.toneAccuracyCollectionId;

interface ParsedGroupProgressDocument extends Omit<GroupProgressDocument, 'exerciseStates'> {
    exerciseStates: { [key: string]: ExerciseState };
}

interface EligibleExercise {
    groupID: string;
    melodyLength: number;
    bpm: number;
}

function safeParseExerciseStates(jsonString: string | null | undefined): { [key: string]: ExerciseState } {
    if (!jsonString) {
        return {};
    }
    try {
        const parsed = JSON.parse(jsonString);
        if (typeof parsed === 'object' && parsed !== null) {
            for (const key in parsed) {
                const state = parsed[key];
                if (typeof state !== 'object' || state === null ||
                    typeof state.currentBPM !== 'number' ||
                    (state.accuracyLastAttempt !== null && typeof state.accuracyLastAttempt !== 'number') ||
                    typeof state.isGraduated !== 'boolean' ||
                    typeof state.unlocked !== 'boolean' ||
                    (state.accuracyHistory !== undefined && !Array.isArray(state.accuracyHistory))
                ) {
                    console.warn(`safeParseExerciseStates: Invalid structure for key "${key}". Removing entry.`);
                    delete parsed[key];
                } else if (state.accuracyHistory === undefined) {
                    state.accuracyHistory = [];
                }
            }
            return parsed;
        } else {
             console.warn("safeParseExerciseStates: Parsed data is not a non-null object.");
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
        const { databases } = await createAdminClient();
        const queries = [
            Query.equal("userID", userID),
            Query.equal("context", context),
            Query.equal("groupID", groupID),
            Query.limit(1)
        ];
        const response = await databases.listDocuments<GroupProgressDocument>(
            databaseId, groupProgressCollectionId, queries
        );
        return response.total > 0 ? response.documents[0] : null;
    } catch (error) {
        console.error("Error fetching GroupProgress:", error);
        throw new Error(`Failed to get GroupProgress: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function getGroupProgressParsed(
    userID: string,
    context: string,
    groupID: string
): Promise<ParsedGroupProgressDocument | null> {
    try {
        const rawDoc = await getGroupProgress(userID, context, groupID);
        if (!rawDoc) return null;
        const parsedStates = safeParseExerciseStates(rawDoc.exerciseStates);
        return { ...rawDoc, exerciseStates: parsedStates };
    } catch (error) {
        console.error("Error in getGroupProgressParsed:", error);
        throw new Error(`Failed to parse GroupProgress: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function createGroupProgress(
    userID: string,
    context: string,
    groupID: string,
    level: number
): Promise<GroupProgressDocument> {
    try {
        const { databases } = await createAdminClient();
        const initialExerciseStatesObject: { [melodyLength: string]: ExerciseState } = {
            "2": { currentBPM: 60, accuracyLastAttempt: null, isGraduated: false, unlocked: true, accuracyHistory: [] }
        };
        const initialExerciseStatesString = JSON.stringify(initialExerciseStatesObject);
        const newDocumentData = { userID, context, groupID, level, exerciseStates: initialExerciseStatesString, isActive: true, lastPracticed: new Date().toISOString() };
        const newDocument = await databases.createDocument<GroupProgressDocument>(
            databaseId, groupProgressCollectionId, ID.unique(), newDocumentData
        );
        return newDocument;
    } catch (error) {
        console.error("Error creating GroupProgress:", error);
        throw new Error(`Failed to create GroupProgress: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function updateGroupProgress(
    documentId: string,
    updatedData: Partial<Pick<GroupProgressDocument, 'level' | 'isActive' | 'lastPracticed'>> & {
        exerciseStates?: { [key: string]: ExerciseState }
    }
): Promise<GroupProgressDocument> {
    try {
        const { databases } = await createAdminClient();
        const dataToUpdate: { [key: string]: any } = {};
        if (updatedData.level !== undefined) dataToUpdate.level = updatedData.level;
        if (updatedData.isActive !== undefined) dataToUpdate.isActive = updatedData.isActive;
        if (updatedData.lastPracticed !== undefined) dataToUpdate.lastPracticed = updatedData.lastPracticed;
        if (updatedData.exerciseStates) {
            if (typeof updatedData.exerciseStates !== 'object' || updatedData.exerciseStates === null) throw new Error("Invalid exerciseStates format");
            dataToUpdate.exerciseStates = JSON.stringify(updatedData.exerciseStates);
        } else if (updatedData.hasOwnProperty('exerciseStates') && updatedData.exerciseStates === undefined) delete dataToUpdate.exerciseStates;
        if (Object.keys(dataToUpdate).length === 0) {
            return await databases.getDocument<GroupProgressDocument>(databaseId, groupProgressCollectionId, documentId);
        }
        const updatedDocument = await databases.updateDocument<GroupProgressDocument>(
            databaseId, groupProgressCollectionId, documentId, dataToUpdate
        );
        return updatedDocument;
    } catch (error) {
        console.error("Error updating GroupProgress:", error);
        throw new Error(`Failed to update GroupProgress document ${documentId}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function handleExerciseCompletion(userId: string,
    context: string,
    groupId: string,
    melodyLength: number,
    accuracy: number
): Promise<{ success: true, newBPM: number, level: number } | { success: false, error: string }> {
    try {
        const currentProgress = await getGroupProgressParsed(userId, context, groupId);
        if (!currentProgress) throw new Error("Progress document not found for update.");
        const exerciseKey = String(melodyLength);
        const currentExerciseState = currentProgress.exerciseStates[exerciseKey];
        if (!currentExerciseState) throw new Error(`Exercise state for length ${melodyLength} not found`);

        let newBPM = currentExerciseState.currentBPM;
        const BpmIncreaseThreshold = 0.8; const MaxBPM = 180; const BpmIncrement = 5; const UnlockThresholdBPM = 100;
        if (accuracy >= BpmIncreaseThreshold && newBPM < MaxBPM) newBPM = Math.min(currentExerciseState.currentBPM + BpmIncrement, MaxBPM);

        const currentHistory = currentExerciseState.accuracyHistory || [];
        const updatedHistory = [...currentHistory, accuracy];
        if (updatedHistory.length > MAX_ACCURACY_HISTORY) updatedHistory.shift();

        const updatedExerciseStates = { ...currentProgress.exerciseStates };
        updatedExerciseStates[exerciseKey] = { ...currentExerciseState, currentBPM: newBPM, accuracyLastAttempt: accuracy, isGraduated: newBPM >= MaxBPM, accuracyHistory: updatedHistory };

        if (melodyLength === 2 && newBPM >= UnlockThresholdBPM) {
            const nextMelodyLengthKey = String(melodyLength + 1);
            if (!updatedExerciseStates[nextMelodyLengthKey]?.unlocked) {
                updatedExerciseStates[nextMelodyLengthKey] = { currentBPM: 60, accuracyLastAttempt: null, isGraduated: false, unlocked: true, accuracyHistory: [] };
            }
        }

        const updatedData = { exerciseStates: updatedExerciseStates, lastPracticed: new Date().toISOString() };
        await updateGroupProgress(currentProgress.$id, updatedData);
        return { success: true, newBPM: newBPM, level: currentProgress.level };
    } catch (error) {
        console.error("Error in handleExerciseCompletion Server Action:", error);
        return { success: false, error: error instanceof Error ? error.message : "Unknown error during exercise completion handling" };
    }
}

async function getAllProgressForLevel(
    userID: string,
    context: string,
    level: number
): Promise<ParsedGroupProgressDocument[]> {
    try {
        const { databases } = await createAdminClient();
        const MAX_GROUPS_PER_LEVEL = 100;
        const queries = [ Query.equal("userID", userID), Query.equal("context", context), Query.equal("level", level), Query.limit(MAX_GROUPS_PER_LEVEL) ];
        const response = await databases.listDocuments<GroupProgressDocument>( databaseId, groupProgressCollectionId, queries );
        return response.documents.map(doc => ({ ...doc, exerciseStates: safeParseExerciseStates(doc.exerciseStates) }));
    } catch (error) {
        console.error(`Error fetching all progress for level ${level}:`, error);
        throw new Error(`Failed to get all progress for level ${level}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function completeAndGetNextExercise(userId: string,
    context: string,
    completedGroupId: string,
    completedMelodyLength: number,
    overallAccuracy: number
): Promise<{ success: true; nextExercise: EligibleExercise; } | { success: true; allGraduatedAtLevel: true; level: number; } | { success: false; error: string; }> {
    try {
        const updateResult = await handleExerciseCompletion( userId, context, completedGroupId, completedMelodyLength, overallAccuracy );
        if (!updateResult.success) return { success: false, error: updateResult.error };
        const currentLevel = updateResult.level;
        const allProgressAtLevel = await getAllProgressForLevel(userId, context, currentLevel);
        const eligibleExercises: EligibleExercise[] = [];
        for (const doc of allProgressAtLevel) {
            for (const key in doc.exerciseStates) {
                const state = doc.exerciseStates[key];
                if (state.unlocked && !state.isGraduated) {
                    eligibleExercises.push({ groupID: doc.groupID, melodyLength: Number(key), bpm: state.currentBPM });
                }
            }
        }
        if (eligibleExercises.length === 0) return { success: true, allGraduatedAtLevel: true, level: currentLevel };
        const randomIndex = Math.floor(Math.random() * eligibleExercises.length);
        const nextExercise = eligibleExercises[randomIndex];
        return { success: true, nextExercise: nextExercise, };
    } catch (error) {
        console.error("Error in completeAndGetNextExercise:", error);
        return { success: false, error: error instanceof Error ? error.message : "Unknown error determining next exercise" };
    }
}

export async function getFirstExercise(
    userID: string,
    context: string,
    initialGroupID: string,
    initialLevel: number
): Promise<{ success: true; exerciseParams: EligibleExercise; } | { success: false; error: string; }> {
    try {
        let progressDoc = await getGroupProgressParsed(userID, context, initialGroupID);
        const initialMelodyLength = 2; const initialMelodyLengthKey = String(initialMelodyLength); let exerciseBPM = 60;
        if (!progressDoc) {
            const newDoc = await createGroupProgress(userID, context, initialGroupID, initialLevel);
            exerciseBPM = 60;
            progressDoc = await getGroupProgressParsed(userID, context, initialGroupID);
             if (!progressDoc) throw new Error("Failed to retrieve the document immediately after creation.");
        } else {
            const exerciseState = progressDoc.exerciseStates[initialMelodyLengthKey];
            if (exerciseState && exerciseState.unlocked) exerciseBPM = exerciseState.currentBPM;
            else {
                 exerciseBPM = 60;
                 const updatedStates = { ...progressDoc.exerciseStates, [initialMelodyLengthKey]: { currentBPM: exerciseBPM, accuracyLastAttempt: null, isGraduated: false, unlocked: true, accuracyHistory: progressDoc.exerciseStates[initialMelodyLengthKey]?.accuracyHistory || [] } };
                 await updateGroupProgress(progressDoc.$id, { exerciseStates: updatedStates });
            }
        }
        return { success: true, exerciseParams: { groupID: initialGroupID, melodyLength: initialMelodyLength, bpm: exerciseBPM, } };
    } catch (error) {
        console.error("Error in getFirstExercise:", error);
        return { success: false, error: error instanceof Error ? error.message : "Unknown error determining first exercise" };
    }
}


export async function recordToneAccuracy(
    userID: string,
    context: string,
    scaleDegree: string,
    isCorrect: boolean
): Promise<{ success: boolean, error?: string }> {
    if (!toneAccuracyCollectionId) {
        console.error("Tone Accuracy Collection ID is not configured.");
        return { success: false, error: "Tone accuracy tracking is not configured." };
    }
     if (!scaleDegree || typeof scaleDegree !== 'string' || scaleDegree.trim() === '') {
         console.warn("recordToneAccuracy: Invalid scaleDegree provided:", scaleDegree);
         return { success: false, error: "Invalid scale degree." };
     }

    try {
        const { databases } = await createAdminClient();
        const accuracyValue = isCorrect ? 1 : 0;
        const nowISO = new Date().toISOString();

        const queries = [
            Query.equal("userID", userID),
            Query.equal("context", context),
            Query.equal("scaleDegree", scaleDegree),
            Query.limit(1)
        ];

        const existingDocs = await databases.listDocuments<ToneAccuracyDocument>(
            databaseId,
            toneAccuracyCollectionId,
            queries
        );

        if (existingDocs.total > 0) {
            const docToUpdate = existingDocs.documents[0];
            const currentHistory = docToUpdate.accuracyHistory || [];
            const updatedHistory = [...currentHistory, accuracyValue];

            if (updatedHistory.length > MAX_TONE_ACCURACY_HISTORY) {
                updatedHistory.shift();
            }

            await databases.updateDocument<ToneAccuracyDocument>(
                databaseId,
                toneAccuracyCollectionId,
                docToUpdate.$id,
                {
                    accuracyHistory: updatedHistory,
                    lastUpdated: nowISO
                }
            );
             console.log(`Tone accuracy updated for user ${userID}, context ${context}, degree ${scaleDegree}`);

        } else {
            const newDocumentData = {
                userID,
                context,
                scaleDegree,
                accuracyHistory: [accuracyValue],
                lastUpdated: nowISO
            };
            await databases.createDocument<ToneAccuracyDocument>(
                databaseId,
                toneAccuracyCollectionId,
                ID.unique(),
                newDocumentData
            );
             console.log(`Tone accuracy created for user ${userID}, context ${context}, degree ${scaleDegree}`);
        }

        return { success: true };

    } catch (error) {
        console.error(`Error recording tone accuracy for ${userID}, ${context}, ${scaleDegree}:`, error);
        return { success: false, error: error instanceof Error ? error.message : "Failed to record tone accuracy" };
    }
}
