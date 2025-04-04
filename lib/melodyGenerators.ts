import * as Tone from "tone";

interface RhythmGeneratorOptions {
  totalBeats?: number;
  shortestDuration?: string;
  longestDuration?: string;
  n?: number;
  allowRests?: boolean;
  restProbability?: number;
}

interface RhythmEvent {
  type: 'note' | 'rest';
  duration: string;
  value: number;
}

type DurationMap = Record<string, number>;

export const durationValues: DurationMap = {
  "32n": 1 / 8,
  "16n": 1 / 4,
  "16n.": 3 / 8,
  "8n": 1 / 2,
  "8n.": 3 / 4,
  "4n": 1,
  "4n.": 1.5,
  "2n": 2,
  "2n.": 3,
  "1n": 4
};

const absoluteMinDurationValue: number = Math.min(...Object.values(durationValues));

export const rhythmGenerator = ({
  totalBeats = 4,
  shortestDuration = "16n",
  longestDuration = "2n",
  n = 4,
  allowRests = true,
  restProbability = 0.2
}: RhythmGeneratorOptions = {}): RhythmEvent[] => {
    const TOLERANCE: number = 1e-9;
    
    const getDurationValue = (notation: string): number => 
        durationValues[notation] ?? durationValues["16n"];

    const getDurationNotation = (value: number): string | null => {
        for (const [notation, val] of Object.entries(durationValues)) {
            if (Math.abs(val - value) < TOLERANCE) return notation;
        }
        return null;
    };

    let currentShortest: string = shortestDuration;
    let currentLongest: string = longestDuration;
    let minDurationValue: number = getDurationValue(currentShortest);
    let maxDurationValue: number = getDurationValue(currentLongest);

    if (minDurationValue > maxDurationValue) {
        [currentShortest, currentLongest] = [currentLongest, currentShortest];
        [minDurationValue, maxDurationValue] = [maxDurationValue, minDurationValue];
    }

    const result: RhythmEvent[] = [];

    if (!allowRests) {
        return generateFixedNumberOfNotes(n, minDurationValue, maxDurationValue, currentShortest);
    } else {
        return generateRhythmWithRests(totalBeats, n, minDurationValue, maxDurationValue, 
            currentShortest, restProbability, TOLERANCE);
    }
    
    function generateFixedNumberOfNotes(
        noteCount: number, 
        minValue: number, 
        maxValue: number,
        defaultDuration: string
    ): RhythmEvent[] {
        const localResult: RhythmEvent[] = [];
        const availableNoteDurations = Object.entries(durationValues)
          .filter(([, value]) => value >= minValue - TOLERANCE && value <= maxValue + TOLERANCE)
          .map(([name, value]) => ({ name, value }));

        if (availableNoteDurations.length === 0) {
            return [];
        }

        for (let i = 0; i < noteCount; i++) {
            const randomIndex: number = Math.floor(Math.random() * availableNoteDurations.length);
            const randomDuration = availableNoteDurations[randomIndex];
            localResult.push({
              type: "note",
              duration: randomDuration.name,
              value: randomDuration.value
            });
        }
        
        return localResult;
    }
    
    function generateRhythmWithRests(
        totalBeats: number,
        targetNotes: number,
        minValue: number,
        maxValue: number,
        defaultShortestDuration: string,
        restProb: number,
        tolerance: number
    ): RhythmEvent[] {
        const localResult: RhythmEvent[] = [];
        let remainingBeats: number = totalBeats;
        let remainingNotes: number = targetNotes;

        const getRandomDuration = (minVal: number, maxVal: number): { name: string; value: number } | null => {
            const availableDurations = Object.entries(durationValues)
                .filter(([, value]) => value >= minVal - tolerance && value <= maxVal + tolerance)
                .map(([name, value]) => ({ name, value }));

            if (availableDurations.length === 0) {
                 if (minValue <= maxVal + tolerance) {
                     return { name: defaultShortestDuration, value: minValue };
                 }
                 return null;
            }
            const randomIndex: number = Math.floor(Math.random() * availableDurations.length);
            return availableDurations[randomIndex];
        };

        while (remainingNotes > 0 && remainingBeats >= absoluteMinDurationValue - tolerance) {
            if (remainingBeats < minValue - tolerance) {
                 break;
            }

            const avgTimePerNote: number = remainingNotes > 0 ? remainingBeats / remainingNotes : remainingBeats;
            const maxPossibleValue: number = Math.min(maxValue, avgTimePerNote, remainingBeats);

            if (maxPossibleValue < minValue - tolerance) {
                break;
            }
            
            const durationToUse = getRandomDuration(minValue, maxPossibleValue);
            if (!durationToUse) {
                break;
            }

            const isRest: boolean = Math.random() < restProb && localResult.length > 0;

            localResult.push({
              type: isRest ? "rest" : "note",
              duration: durationToUse.name,
              value: durationToUse.value
            });

            remainingBeats -= durationToUse.value;
            if (!isRest) {
              remainingNotes--;
            }
            if (Math.abs(remainingBeats) < tolerance) remainingBeats = 0;
        }

        fillRemainingBeatsWithRests(localResult, remainingBeats, tolerance);
        
        return localResult;
    }
    
    function fillRemainingBeatsWithRests(
        events: RhythmEvent[], 
        remainingBeats: number,
        tolerance: number
    ): void {
        if (remainingBeats > tolerance) {
            const availableRestDurations = Object.entries(durationValues)
                .map(([name, value]) => ({ name, value }))
                .sort((a, b) => b.value - a.value);

            if (availableRestDurations.length > 0) {
                while (remainingBeats >= absoluteMinDurationValue - tolerance) {
                    let durationToAdd: { name: string; value: number } | null = null;
                    for (const dur of availableRestDurations) {
                        if (dur.value <= remainingBeats + tolerance) {
                            durationToAdd = dur; 
                            break;
                        }
                    }
                    if (durationToAdd) {
                        events.push({ 
                            type: "rest", 
                            duration: durationToAdd.name, 
                            value: durationToAdd.value 
                        });
                        remainingBeats -= durationToAdd.value;
                        if (Math.abs(remainingBeats) < tolerance) remainingBeats = 0;
                    } else { 
                        break; 
                    }
                }
            }
        }
    }
};