"use server";
import { ID, Query, Databases, Models } from "node-appwrite";
import { createAdminClient } from "../appwrite";
import { appwriteConfig } from "../appwrite/config";

const MAX_ACCURACY_HISTORY = 100;
const MAX_TONE_ACCURACY_HISTORY = 50;
const MAX_LEVEL_MAJOR = 6;

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
                    delete parsed[key];
                } else if (state.accuracyHistory === undefined) {
                    state.accuracyHistory = [];
                }
            }
            return parsed;
        } else {
            return {};
        }
    } catch (e) {
        return {};
    }
}

async function getAllProgressForLevel(
    userID: string,
    context: string,
    level: number
): Promise<ParsedGroupProgressDocument[]> {
    try {
        const { databases } = await createAdminClient();
        const MAX_GROUPS_PER_LEVEL = 200;
        const queries = [
             Query.equal("userID", userID),
             Query.equal("context", context),
             Query.equal("level", level),
             Query.limit(MAX_GROUPS_PER_LEVEL)
        ];
        const response = await databases.listDocuments<GroupProgressDocument>(
            databaseId, groupProgressCollectionId, queries
        );
        return response.documents.map(doc => ({
             ...doc,
             exerciseStates: safeParseExerciseStates(doc.exerciseStates)
        }));
    } catch (error) {
        throw new Error(`Failed to get all progress for level ${level}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function ensureLevelGroupsExist(
    userId: string,
    context: string,
    targetLevel: number
): Promise<{ success: boolean; groupsCreated: number; totalExpectedGroups: number; error?: string }> {
    let maxLevel: number;
    if (context.toLowerCase() === 'major') {
        maxLevel = MAX_LEVEL_MAJOR;
    } else {
        return { success: false, groupsCreated: 0, totalExpectedGroups: 0, error: `Unsupported context: ${context}` };
    }

    if (targetLevel < 1 || targetLevel > maxLevel) {
        return { success: false, groupsCreated: 0, totalExpectedGroups: 0, error: `Target level ${targetLevel} is out of bounds (1-${maxLevel})` };
    }

    try {
        const expectedGroupIDs = await generateLevelGroupCombinations(context, targetLevel);
        const totalExpectedGroups = expectedGroupIDs.length;

        if (totalExpectedGroups === 0) {
             return { success: false, groupsCreated: 0, totalExpectedGroups: 0, error: `No group combinations generated for level ${targetLevel}` };
        }

        const existingProgressDocs = await getAllProgressForLevel(userId, context, targetLevel);
        const existingGroupIDs = new Set(existingProgressDocs.map(doc => doc.groupID));

        const missingGroupIDs = expectedGroupIDs.filter(id => !existingGroupIDs.has(id));
        let groupsCreated = 0;

        if (missingGroupIDs.length > 0) {
            await Promise.all(missingGroupIDs.map(groupID =>
                createGroupProgress(userId, context, groupID, targetLevel)
            ));
            groupsCreated = missingGroupIDs.length;
        }

        return { success: true, groupsCreated: groupsCreated, totalExpectedGroups: totalExpectedGroups };

    } catch (error) {
        return { success: false, groupsCreated: 0, totalExpectedGroups: 0, error: `Failed ensure groups for level ${targetLevel}: ${error instanceof Error ? error.message : String(error)}` };
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
        const newDocumentData = {
            userID,
            context,
            groupID,
            level,
            exerciseStates: initialExerciseStatesString,
            isActive: true,
            lastPracticed: new Date().toISOString()
        };
        const newDocument = await databases.createDocument<GroupProgressDocument>(
            databaseId, groupProgressCollectionId, ID.unique(), newDocumentData
        );
        return newDocument;
    } catch (error) {
        throw new Error(`Failed to create GroupProgress for ${groupID}: ${error instanceof Error ? error.message : String(error)}`);
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
        dataToUpdate.lastPracticed = new Date().toISOString();
        if (updatedData.exerciseStates) {
            if (typeof updatedData.exerciseStates !== 'object' || updatedData.exerciseStates === null) {
                 throw new Error("Invalid exerciseStates format for update");
            }
            for (const key in updatedData.exerciseStates) {
                if (!updatedData.exerciseStates[key].accuracyHistory) {
                     updatedData.exerciseStates[key].accuracyHistory = [];
                }
            }
            dataToUpdate.exerciseStates = JSON.stringify(updatedData.exerciseStates);
        }

        if (Object.keys(dataToUpdate).length === 0) {
            return await databases.getDocument<GroupProgressDocument>(databaseId, groupProgressCollectionId, documentId);
        }
        const updatedDocument = await databases.updateDocument<GroupProgressDocument>(
            databaseId, groupProgressCollectionId, documentId, dataToUpdate
        );
        return updatedDocument;
    } catch (error) {
        throw new Error(`Failed to update GroupProgress document ${documentId}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function handleExerciseCompletion(userId: string,
    context: string,
    groupId: string,
    melodyLength: number,
    accuracy: number
): Promise<{ success: true, newBPM: number, level: number, graduatedCurrentExercise: boolean } | { success: false, error: string }> {
    try {
        const currentProgress = await getGroupProgressParsed(userId, context, groupId);
        if (!currentProgress) throw new Error(`Progress document not found for user ${userId}, group ${groupId}`);

        const exerciseKey = String(melodyLength);
        const currentExerciseState = currentProgress.exerciseStates[exerciseKey];
        if (!currentExerciseState) throw new Error(`Exercise state for length ${melodyLength} not found in group ${groupId}`);
        if (!currentExerciseState.unlocked) throw new Error(`Attempted to complete a locked exercise: group ${groupId}, length ${melodyLength}`);

        let newBPM = currentExerciseState.currentBPM;
        const BpmIncreaseThreshold = 0.8; const MaxBPM = 180; const BpmIncrement = 5; const UnlockThresholdBPM = 100; const MaxMelodyLength = 12;

        if (accuracy >= BpmIncreaseThreshold && newBPM < MaxBPM) {
            newBPM = Math.min(currentExerciseState.currentBPM + BpmIncrement, MaxBPM);
        }

        const currentHistory = currentExerciseState.accuracyHistory || [];
        const updatedHistory = [...currentHistory, accuracy];
        if (updatedHistory.length > MAX_ACCURACY_HISTORY) {
            updatedHistory.shift();
        }

        const isNowGraduated = newBPM >= MaxBPM;

        const updatedExerciseStates = { ...currentProgress.exerciseStates };
        updatedExerciseStates[exerciseKey] = {
            ...currentExerciseState,
            currentBPM: newBPM,
            accuracyLastAttempt: accuracy,
            isGraduated: isNowGraduated,
            accuracyHistory: updatedHistory
        };

        if (!isNowGraduated &&
            melodyLength < MaxMelodyLength &&
            newBPM >= UnlockThresholdBPM)
        {
            const nextMelodyLengthKey = String(melodyLength + 1);
            if (!updatedExerciseStates[nextMelodyLengthKey] || !updatedExerciseStates[nextMelodyLengthKey].unlocked) {
                 if (!updatedExerciseStates[nextMelodyLengthKey]) {
                     updatedExerciseStates[nextMelodyLengthKey] = { currentBPM: 60, accuracyLastAttempt: null, isGraduated: false, unlocked: true, accuracyHistory: [] };
                 } else {
                     updatedExerciseStates[nextMelodyLengthKey].unlocked = true;
                     updatedExerciseStates[nextMelodyLengthKey].currentBPM = 60;
                     updatedExerciseStates[nextMelodyLengthKey].accuracyLastAttempt = null;
                     updatedExerciseStates[nextMelodyLengthKey].isGraduated = false;
                 }
            }
        }

        const updatedData = { exerciseStates: updatedExerciseStates };
        await updateGroupProgress(currentProgress.$id, updatedData);

        return { success: true, newBPM: newBPM, level: currentProgress.level, graduatedCurrentExercise: isNowGraduated };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Unknown error during exercise completion handling" };
    }
}

export async function completeAndGetNextExercise(
    userId: string,
    context: string,
    completedGroupId: string,
    completedMelodyLength: number,
    overallAccuracy: number
): Promise<{ success: true; nextExercise: EligibleExercise; } | { success: true; allGraduatedAtLevel: true; level: number; } | { success: false; error: string; }> {
    try {
        const updateResult = await handleExerciseCompletion(
            userId, context, completedGroupId, completedMelodyLength, overallAccuracy
        );

        if (!updateResult.success) {
            return { success: false, error: updateResult.error };
        }

        const currentLevel = updateResult.level;

        const currentLevelProgress = await getAllProgressForLevel(userId, context, currentLevel);
        const eligibleExercises: EligibleExercise[] = [];
        let allExercisesAtCurrentLevelGraduated = true;

        if (currentLevelProgress.length === 0) {
             allExercisesAtCurrentLevelGraduated = true;
        } else {
            for (const doc of currentLevelProgress) {
                for (const key in doc.exerciseStates) {
                    const state = doc.exerciseStates[key];
                    if (state.unlocked) {
                        if (!state.isGraduated) {
                            allExercisesAtCurrentLevelGraduated = false;
                            if (!(doc.groupID === completedGroupId && Number(key) === completedMelodyLength && updateResult.graduatedCurrentExercise)) {
                                eligibleExercises.push({
                                    groupID: doc.groupID,
                                    melodyLength: Number(key),
                                    bpm: state.currentBPM
                                });
                            }
                        }
                    } else {
                         allExercisesAtCurrentLevelGraduated = false;
                    }
                }
            }
        }


        if (eligibleExercises.length > 0) {
            if (eligibleExercises.length === 1) {
                return { success: true, nextExercise: eligibleExercises[0] };
            }
            eligibleExercises.sort((a, b) => a.bpm - b.bpm);
            const N = eligibleExercises.length;
            const weights: number[] = eligibleExercises.map((_, index) => N - index);
            const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
            let randomWeight = Math.random() * totalWeight;
            let chosenExercise: EligibleExercise | null = null;
            for (let i = 0; i < eligibleExercises.length; i++) {
                randomWeight -= weights[i];
                if (randomWeight <= 0) {
                    chosenExercise = eligibleExercises[i];
                    break;
                }
            }
            if (!chosenExercise) {
                chosenExercise = eligibleExercises[N - 1];
            }
            return { success: true, nextExercise: chosenExercise };
        }


        if (allExercisesAtCurrentLevelGraduated) {
            const nextLevel = currentLevel + 1;
            let maxLevel: number;
            if (context.toLowerCase() === 'major') maxLevel = MAX_LEVEL_MAJOR; else return { success: false, error: `Invalid context ${context}` };

            if (nextLevel > maxLevel) {
                return { success: true, allGraduatedAtLevel: true, level: currentLevel };
            }

            const initResult = await ensureLevelGroupsExist(userId, context, nextLevel);

            if (!initResult.success) {
                 return { success: false, error: initResult.error ?? `Failed to initialize level ${nextLevel}` };
            }

            const nextLevelProgress = await getAllProgressForLevel(userId, context, nextLevel);
            const nextLevelEligibleExercises: EligibleExercise[] = [];
            for (const doc of nextLevelProgress) {
                for (const key in doc.exerciseStates) {
                    const state = doc.exerciseStates[key];
                    if (state.unlocked && !state.isGraduated) {
                        nextLevelEligibleExercises.push({
                            groupID: doc.groupID,
                            melodyLength: Number(key),
                            bpm: state.currentBPM
                        });
                    }
                }
            }

            if (nextLevelEligibleExercises.length === 0) {
                return { success: false, error: `No eligible exercises found for level ${nextLevel} after initialization.` };
            }

            nextLevelEligibleExercises.sort((a, b) => a.bpm - b.bpm);
            const N_next = nextLevelEligibleExercises.length;
            const weights_next: number[] = nextLevelEligibleExercises.map((_, index) => N_next - index);
            const totalWeight_next = weights_next.reduce((sum, weight) => sum + weight, 0);
            let randomWeight_next = Math.random() * totalWeight_next;
            let chosenExercise_next: EligibleExercise | null = null;
            for (let i = 0; i < nextLevelEligibleExercises.length; i++) {
                randomWeight_next -= weights_next[i];
                if (randomWeight_next <= 0) {
                    chosenExercise_next = nextLevelEligibleExercises[i];
                    break;
                }
            }
            if (!chosenExercise_next) {
                chosenExercise_next = nextLevelEligibleExercises[N_next - 1];
            }
            return { success: true, nextExercise: chosenExercise_next };

        } else {
             const nextLevel = currentLevel + 1;
             let maxLevel: number;
             if (context.toLowerCase() === 'major') maxLevel = MAX_LEVEL_MAJOR; else return { success: false, error: `Invalid context ${context}` };

             if (nextLevel > maxLevel) {
                 return { success: true, allGraduatedAtLevel: true, level: currentLevel };
             }

             const initResult = await ensureLevelGroupsExist(userId, context, nextLevel);
             if (!initResult.success) return { success: false, error: initResult.error ?? `Failed to initialize level ${nextLevel} (edge case)` };

             const nextLevelProgress = await getAllProgressForLevel(userId, context, nextLevel);
             const nextLevelEligibleExercises: EligibleExercise[] = [];
             for (const doc of nextLevelProgress) { for (const key in doc.exerciseStates) { const state = doc.exerciseStates[key]; if (state.unlocked && !state.isGraduated) { nextLevelEligibleExercises.push({ groupID: doc.groupID, melodyLength: Number(key), bpm: state.currentBPM }); } } }

             if (nextLevelEligibleExercises.length === 0) return { success: false, error: `No eligible exercises found for level ${nextLevel} after initialization (edge case).` };

             nextLevelEligibleExercises.sort((a, b) => a.bpm - b.bpm);
             const N_next = nextLevelEligibleExercises.length; const weights_next: number[] = nextLevelEligibleExercises.map((_, index) => N_next - index); const totalWeight_next = weights_next.reduce((sum, weight) => sum + weight, 0); let randomWeight_next = Math.random() * totalWeight_next; let chosenExercise_next: EligibleExercise | null = null; for (let i = 0; i < nextLevelEligibleExercises.length; i++) { randomWeight_next -= weights_next[i]; if (randomWeight_next <= 0) { chosenExercise_next = nextLevelEligibleExercises[i]; break; } } if (!chosenExercise_next) chosenExercise_next = nextLevelEligibleExercises[N_next - 1];

             return { success: true, nextExercise: chosenExercise_next };
        }

    } catch (error) {
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
        const initResult = await ensureLevelGroupsExist(userID, context, initialLevel);

        if (!initResult.success) {
            return { success: false, error: initResult.error ?? `Failed to ensure groups exist for level ${initialLevel}` };
        }
        if (initResult.totalExpectedGroups === 0 && !initResult.error) {
             return { success: false, error: `No groups defined for level ${initialLevel} in context ${context}.` };
        }

        const targetLevel = initialLevel;
        const levelProgress = await getAllProgressForLevel(userID, context, targetLevel);
        const eligibleExercises: EligibleExercise[] = [];
        for (const doc of levelProgress) {
            for (const key in doc.exerciseStates) {
                const state = doc.exerciseStates[key];
                if (state.unlocked && !state.isGraduated) {
                    eligibleExercises.push({
                        groupID: doc.groupID,
                        melodyLength: Number(key),
                        bpm: state.currentBPM
                    });
                }
            }
        }

        if (eligibleExercises.length === 0) {
             return { success: false, error: `No available exercises found for level ${targetLevel} after ensuring groups exist.` };
        }

        eligibleExercises.sort((a, b) => a.bpm - b.bpm);
        const N = eligibleExercises.length;
        const weights: number[] = eligibleExercises.map((_, index) => N - index);
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        let randomWeight = Math.random() * totalWeight;
        let chosenExercise: EligibleExercise | null = null;
        for (let i = 0; i < eligibleExercises.length; i++) {
            randomWeight -= weights[i];
            if (randomWeight <= 0) {
                chosenExercise = eligibleExercises[i];
                break;
            }
        }
        if (!chosenExercise) {
            chosenExercise = eligibleExercises[N - 1];
        }

        return { success: true, exerciseParams: chosenExercise };

    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Unknown error determining first exercise" };
    }
}

export async function generateLevelGroupCombinations(
    context: string,
    level: number
): Promise<string[]> {
    let baseDegrees: string[];
    if (context.toLowerCase() === 'major') {
        baseDegrees = ['1', '2', '3', '4', '5', '6', '7'];
    } else {
        throw new Error(`Unsupported context: ${context}`);
    }

    const groupSize = level + 1;

    if (level < 1 || level > (baseDegrees.length - 1)) {
        throw new Error(`Invalid level: ${level}. Must be between 1 and ${baseDegrees.length - 1}`);
    }
    if (groupSize > baseDegrees.length) {
         throw new Error(`Cannot form groups of size ${groupSize} from ${baseDegrees.length} base degrees.`);
    }


    const results: string[] = [];
    const tempCombination: string[] = [];

    function findCombinations(startIndex: number) {
        if (tempCombination.length === groupSize) {
            const sortedCombination = [...tempCombination].sort((a, b) => {
                 return parseInt(a, 10) - parseInt(b, 10);
            });
            results.push(`(${sortedCombination.join(',')})`);
            return;
        }

        if (baseDegrees.length - startIndex < groupSize - tempCombination.length) {
             return;
        }

        for (let i = startIndex; i < baseDegrees.length; i++) {
            tempCombination.push(baseDegrees[i]);
            findCombinations(i + 1);
            tempCombination.pop();
        }
    }

    try {
        findCombinations(0);
        return results;
    } catch (error) {
         throw new Error(`Failed to generate combinations: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function recordToneAccuracy(
    userID: string,
    context: string,
    scaleDegree: string,
    isCorrect: boolean
): Promise<{ success: boolean, error?: string }> {
    if (!toneAccuracyCollectionId) {
        return { success: true };
    }
     if (!scaleDegree || typeof scaleDegree !== 'string' || scaleDegree.trim() === '') {
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
        }

        return { success: true };

    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Failed to record tone accuracy" };
    }
}