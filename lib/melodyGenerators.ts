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
      let actualNotes: number = 0;
  
      const availableDurations = Object.entries(durationValues)
        .filter(([, value]) => value >= minValue - tolerance && value <= maxValue + tolerance)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => a.value - b.value);
  
      if (availableDurations.length === 0) {
        return [];
      }
  
      const minSpaceForAllNotes = targetNotes * minValue;
      
      if (minSpaceForAllNotes > totalBeats + tolerance) {
        console.warn(`Cannot fit ${targetNotes} notes with minimum duration ${minValue} in ${totalBeats} beats`);
      }
  
      while (actualNotes < targetNotes && remainingBeats >= minValue - tolerance) {
        const notesRemaining = targetNotes - actualNotes;
        const minSpaceNeeded = notesRemaining * minValue;
        const maxPossibleValue = Math.min(
          maxValue,
          remainingBeats - minSpaceNeeded + minValue,
          remainingBeats
        );
  
        if (maxPossibleValue < minValue - tolerance) {
          break;
        }
  
        const eligibleDurations = availableDurations.filter(d => 
          d.value <= maxPossibleValue + tolerance && d.value >= minValue - tolerance
        );
        
        if (eligibleDurations.length === 0) {
          break;
        }
        
        const randomIndex = Math.floor(Math.random() * eligibleDurations.length);
        const durationToUse = eligibleDurations[randomIndex];
  
        localResult.push({
          type: "note",
          duration: durationToUse.name,
          value: durationToUse.value
        });
        
        remainingBeats -= durationToUse.value;
        actualNotes++;
        
        if (actualNotes < targetNotes && Math.random() < restProb && remainingBeats > minSpaceNeeded - tolerance) {
          const maxRestDuration = remainingBeats - minSpaceNeeded;
          
          if (maxRestDuration >= absoluteMinDurationValue - tolerance) {
            const eligibleRestDurations = availableDurations.filter(d => 
              d.value <= maxRestDuration + tolerance
            );
            
            if (eligibleRestDurations.length > 0) {
              const randomRestIndex = Math.floor(Math.random() * eligibleRestDurations.length);
              const restToUse = eligibleRestDurations[randomRestIndex];
              
              localResult.push({
                type: "rest",
                duration: restToUse.name,
                value: restToUse.value
              });
              
              remainingBeats -= restToUse.value;
            }
          }
        }
      }
  
      if (remainingBeats > tolerance) {
        fillRemainingBeatsWithRests(localResult, remainingBeats, tolerance);
      }
      
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
  };