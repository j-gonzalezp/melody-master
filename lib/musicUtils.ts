import { allNotes } from "./utils";
import * as Tone from "tone";

export type DurationString =
  | "32n" | "16n" | "16n." | "8n" | "8n."
  | "4n" | "4n." | "2n" | "2n." | "1n";

type DurationMap = Readonly<Record<DurationString, number>>;

export interface RhythmEvent {
  type: 'note' | 'rest';
  duration: DurationString;
  value: number;
}

export interface RhythmGeneratorOptions {
  totalBeats?: number;
  shortestDuration?: DurationString;
  longestDuration?: DurationString;
  n?: number;
  allowRests?: boolean;
  restProbability?: number;
}

export interface AvailableNotesOptions {
  allNotes: ReadonlyArray<string>;
  range: [string, string];
  notes?: ReadonlyArray<string>;
  keyId?: string;
}

export interface GenerateNoteSequenceOptions {
  keyId?: string;
  notes?: ReadonlyArray<string>;
  range: [string, string];
  numberOfNotes: number;
  maxInterval?: number;
  minInterval?: number;
}

export interface SequenceEvent {
    type: 'note' | 'rest';
    duration: DurationString;
    value: number;
    startTime: number;
    note?: string;
}

export interface MetronomeEvent {
    time: number;
    note: string;
    velocity: number;
    isAccent: boolean;
}

export interface MetronomeInstruments {
    metronome: Tone.MetalSynth;
    metronomeAccent: Tone.MetalSynth;
}

export interface PlaySequenceOptions {
  fullSequence: SequenceEvent[];
  generatedNotes: string[];
  piano: Tone.Sampler;
  metronomeInstruments?: MetronomeInstruments;
  loop?: boolean;
  bpm: number;
  onNotePlay?: (time: number, note: string, index: number) => void;
  onLoopStart?: (time: number, count: number) => void;
  onLoopEnd?: (time: number, count: number) => void;

  metronomeEvents?: MetronomeEvent[]
}

export interface SequencePlayerControls {
  notes: ReadonlyArray<string>;
  fullSequence: ReadonlyArray<SequenceEvent>;
  play: () => void;
  stop: () => void;
  readonly isPlaying: boolean;
  onStop: (() => void) | null;
}

const TOLERANCE: number = 1e-9;

export const durationValues: DurationMap = Object.freeze({
  "32n": 1 / 8, "16n": 1 / 4, "16n.": 3 / 8, "8n": 1 / 2, "8n.": 3 / 4,
  "4n": 1, "4n.": 1.5, "2n": 2, "2n.": 3, "1n": 4
});

const durationStrings = Object.keys(durationValues) as DurationString[];

const absoluteMinDurationValue: number = Math.min(...Object.values(durationValues));

const getDurationValue = (notation: string): number =>
    durationValues[notation as DurationString] ?? durationValues["16n"];

const getDurationNotation = (value: number): DurationString | null => {
    for (const [notation, val] of Object.entries(durationValues)) {
        if (Math.abs(val - value) < TOLERANCE) return notation as DurationString;
    }
    return null;
};

const chromaticNotes: ReadonlyArray<string> = Object.freeze([
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"
]);

export const rhythmGenerator = ({
  totalBeats = 4,
  shortestDuration = "16n",
  longestDuration = "2n",
  n = 4,
  allowRests = true,
  restProbability = 0.2
}: RhythmGeneratorOptions = {}): RhythmEvent[] => {

    let currentShortest: DurationString = shortestDuration;
    let currentLongest: DurationString = longestDuration;
    let minDurationValue: number = getDurationValue(currentShortest);
    let maxDurationValue: number = getDurationValue(currentLongest);

    if (minDurationValue > maxDurationValue) {
        [currentShortest, currentLongest] = [currentLongest, currentShortest];
        [minDurationValue, maxDurationValue] = [maxDurationValue, minDurationValue];
    }

    function generateFixedNumberOfNotes(
        noteCount: number,
        minValue: number,
        maxValue: number
    ): RhythmEvent[] {
        const localResult: RhythmEvent[] = [];
        const availableNoteDurations = durationStrings
          .map(name => ({ name, value: durationValues[name] }))
          .filter(({ value }) => value >= minValue - TOLERANCE && value <= maxValue + TOLERANCE);

        if (availableNoteDurations.length === 0) {
            console.warn("No available durations found for the given constraints in generateFixedNumberOfNotes.");
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
        targetTotalBeats: number,
        targetNotes: number,
        minValue: number,
        maxValue: number,
        defaultShortestDurationStr: DurationString,
        restProb: number
    ): RhythmEvent[] {
        const localResult: RhythmEvent[] = [];
        let remainingBeats: number = targetTotalBeats;
        let remainingNotes: number = targetNotes;

        const getMinSpaceNeededForNotes = (notes: number, minVal: number): number => {
            return notes * minVal;
        };

        const getRandomDuration = (minVal: number, maxVal: number): { name: DurationString; value: number } | null => {
             const availableDurations = durationStrings
                .map(name => ({ name, value: durationValues[name] }))
                .filter(({ value }) => value >= minVal - TOLERANCE && value <= maxVal + TOLERANCE);

            if (availableDurations.length === 0) {
                 if (minValue <= maxVal + TOLERANCE) {
                     return { name: defaultShortestDurationStr, value: minValue };
                 }
                 console.warn("Could not find random duration between", minVal, maxVal);
                 return null;
            }
            const randomIndex: number = Math.floor(Math.random() * availableDurations.length);
            return availableDurations[randomIndex];
        };

        while (remainingNotes > 0 && remainingBeats >= absoluteMinDurationValue - TOLERANCE) {
            if (remainingBeats < minValue - TOLERANCE) {
                 console.warn(`Remaining beats (${remainingBeats}) too low for shortest duration (${minValue}). Stopping generation.`);
                 break;
            }

            const minSpaceNeededForAllRemaining = getMinSpaceNeededForNotes(remainingNotes, minValue);
            if (remainingBeats < minSpaceNeededForAllRemaining - TOLERANCE) {
                 console.warn(`Not enough remaining beats (${remainingBeats}) for the required ${remainingNotes} notes (min space needed: ${minSpaceNeededForAllRemaining}). Stopping generation.`);
                 break;
            }

            const maxPossibleValue = Math.min(
                maxValue,
                remainingBeats - (remainingNotes > 1 ? getMinSpaceNeededForNotes(remainingNotes - 1, minValue) : 0),
                remainingBeats
            );

            if (maxPossibleValue < minValue - TOLERANCE) {
                console.warn(`Calculated maxPossibleValue (${maxPossibleValue}) is less than minValue (${minValue}). Cannot proceed.`);
                break;
            }

            const durationToUse = getRandomDuration(minValue, maxPossibleValue);
            if (!durationToUse) {
                 console.warn("Failed to get random duration. Stopping generation.");
                 break;
            }

            const beatsAfterThisEvent = remainingBeats - durationToUse.value;
            const minSpaceNeededAfterEvent = getMinSpaceNeededForNotes(remainingNotes -1, minValue);
            const canPlaceNoteHere = beatsAfterThisEvent >= minSpaceNeededAfterEvent - TOLERANCE;

            const isRest: boolean = allowRests &&
                                   canPlaceNoteHere &&
                                   Math.random() < restProb &&
                                   localResult.length > 0;

            localResult.push({
              type: isRest ? "rest" : "note",
              duration: durationToUse.name,
              value: durationToUse.value
            });

            remainingBeats -= durationToUse.value;
            if (!isRest) {
              remainingNotes--;
            }

            if (Math.abs(remainingBeats) < TOLERANCE) remainingBeats = 0;
        }

        if (remainingNotes > 0) {
            console.warn(`Could only place ${targetNotes - remainingNotes} notes. ${remainingNotes} notes could not be placed.`);
        }

        fillRemainingBeatsWithRests(localResult, remainingBeats);

        return localResult;
    }

    function fillRemainingBeatsWithRests(
        events: RhythmEvent[],
        remaining: number
    ): void {
        let remainingBeats = remaining;
        if (remainingBeats <= TOLERANCE) return;

        const availableRestDurations = durationStrings
                .map(name => ({ name, value: durationValues[name] }))
                .sort((a, b) => b.value - a.value);

        if (availableRestDurations.length === 0) return;

        while (remainingBeats >= absoluteMinDurationValue - TOLERANCE) {
            let durationToAdd: { name: DurationString; value: number } | null = null;
            for (const dur of availableRestDurations) {
                if (dur.value <= remainingBeats + TOLERANCE) {
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
                if (Math.abs(remainingBeats) < TOLERANCE) remainingBeats = 0;
            } else {
                console.warn(`Could not fill remaining ${remainingBeats.toFixed(3)} beats with rests. Smallest rest is ${absoluteMinDurationValue}.`);
                break;
            }
        }
    }

    if (!allowRests) {
        return generateFixedNumberOfNotes(n, minDurationValue, maxDurationValue);
    } else {
        return generateRhythmWithRests(totalBeats, n, minDurationValue, maxDurationValue, currentShortest, restProbability);
    }
};

export const availableNotes = ({
  allNotes: sourceNotes,
  range,
  notes,
  keyId
}: AvailableNotesOptions): string[] => {
  if (!range || range.length !== 2) {
    console.error("Invalid range provided to availableNotes:", range);
    return [];
  }

  const startIndex = sourceNotes.indexOf(range[0]);
  const endIndex = sourceNotes.indexOf(range[1]);

  if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
    console.error("Invalid note range endpoints in availableNotes:", range, "Check against sourceNotes.");
    return [];
  }

  const notesInRange = sourceNotes.slice(startIndex, endIndex + 1);

  if (!notes || notes.length === 0) {
    return notesInRange;
  }

  let noteToDegreeMap: Map<string, string> | null = null;
  if (keyId && keyId.length > 0) {
      const keyIndex = chromaticNotes.indexOf(keyId);
      if (keyIndex === -1) {
          console.warn(`Invalid keyId "${keyId}" provided to availableNotes. Filtering by note name only.`);
      } else {
          noteToDegreeMap = new Map<string, string>();
          for (let i = 0; i < 12; i++) {
              const degreeIndex = i;
              const noteName = chromaticNotes[(keyIndex + degreeIndex) % 12];
              let degree: string;
              switch (degreeIndex) {
                  case 0: degree = "1"; break; case 1: degree = "1#"; break;
                  case 2: degree = "2"; break; case 3: degree = "2#"; break;
                  case 4: degree = "3"; break; case 5: degree = "4"; break;
                  case 6: degree = "4#"; break;
                  case 7: degree = "5"; break; case 8: degree = "5#"; break;
                  case 9: degree = "6"; break; case 10: degree = "6#"; break;
                  case 11: degree = "7"; break;
                  default: degree = "?";
              }
              noteToDegreeMap.set(noteName, degree);
          }
      }
  }

  const result = notesInRange.filter(fullNote => {
    const noteName = fullNote.replace(/\d+$/, '');
    if (notes.includes(noteName)) {
      return true;
    }
    if (notes.includes(fullNote)) {
        return true;
    }
    if (noteToDegreeMap) {
      const degree = noteToDegreeMap.get(noteName);
      if (degree !== undefined && notes.includes(degree)) {
        return true;
      }
    }
    return false;
  });

  if (keyId && result.length > 0) {
      const keyNotes = result.filter(note => note.replace(/\d+$/, '') === keyId);
      if (keyNotes.length > 0) {
          const firstKeyNote = keyNotes[0];
          const firstKeyIndex = result.indexOf(firstKeyNote);
          if (firstKeyIndex > 0) {
              const beforeKey = result.slice(0, firstKeyIndex);
              const fromKey = result.slice(firstKeyIndex);
              return [...fromKey, ...beforeKey];
          }
      }
  }

  return result;
};

export const getDegreeFromNote = (note: string, keyId: string): string => {
  const noteName = note.replace(/\d+$/, '');

  const keyIndex = chromaticNotes.indexOf(keyId);
  const noteIndex = chromaticNotes.indexOf(noteName);

  if (keyIndex === -1 || noteIndex === -1) {
    return "?";
  }

  const degreeIndex = (noteIndex - keyIndex + 12) % 12;

  switch (degreeIndex) {
    case 0: return "1";
    case 1: return "1#";
    case 2: return "2";
    case 3: return "2#";
    case 4: return "3";
    case 5: return "4";
    case 6: return "4#";
    case 7: return "5";
    case 8: return "5#";
    case 9: return "6";
    case 10: return "6#";
    case 11: return "7";
    default: return "?";
  }
};

export const getNoteFromDegree = (degree: string, keyId: string): string => {
  const keyIndex = chromaticNotes.indexOf(keyId);
  if (keyIndex === -1) {
    return "?";
  }

  let semitoneOffset: number;
  switch (degree.toLowerCase()) {
    case "1": semitoneOffset = 0; break;
    case "1#": case "b2": semitoneOffset = 1; break;
    case "2": semitoneOffset = 2; break;
    case "2#": case "b3": semitoneOffset = 3; break;
    case "3": semitoneOffset = 4; break;
    case "4": semitoneOffset = 5; break;
    case "4#": case "b5": semitoneOffset = 6; break;
    case "5": semitoneOffset = 7; break;
    case "5#": case "b6": semitoneOffset = 8; break;
    case "6": semitoneOffset = 9; break;
    case "6#": case "b7": semitoneOffset = 10; break;
    case "7": semitoneOffset = 11; break;
    default: return "?";
  }

  const noteIndex = (keyIndex + semitoneOffset) % 12;
  return chromaticNotes[noteIndex];
};

export const calculateInterval = (note1: string, note2: string): number => {
  const index1 = allNotes.indexOf(note1);
  const index2 = allNotes.indexOf(note2);

  if (index1 === -1) {
    throw new Error(`Invalid note: Note "${note1}" not found in master note list (allNotes).`);
  }
  if (index2 === -1) {
      throw new Error(`Invalid note: Note "${note2}" not found in master note list (allNotes).`);
  }

  return Math.abs(index1 - index2);
};

export const generateNoteSequence = ({
  keyId,
  notes,
  range,
  numberOfNotes,
  maxInterval,
  minInterval
}: GenerateNoteSequenceOptions): string[] => {
  try {
    const available = availableNotes({
      allNotes: allNotes,
      range,
      notes,
      keyId: keyId || ''
    });

    if (available.length === 0) {
      throw new Error("Cannot generate sequence: No notes available for the given constraints.");
    }

    const newSequence: string[] = [];

    const firstNoteIndex = Math.floor(Math.random() * available.length);
    const firstNote = available[firstNoteIndex];
    newSequence.push(firstNote);

    for (let i = 1; i < numberOfNotes; i++) {
      const previousNote = newSequence[i - 1];

      const validNextNotes = available.filter(currentNote => {
          if (currentNote === previousNote && available.length > 1) return false;

          const interval = calculateInterval(currentNote, previousNote);
          const meetsMaxConstraint = maxInterval === undefined || interval <= maxInterval;
          const meetsMinConstraint = minInterval === undefined || interval >= minInterval;
          return meetsMaxConstraint && meetsMinConstraint;
      });

      if (validNextNotes.length === 0) {
        throw new Error(`Generation failed: No valid notes meet interval constraints (${minInterval ?? 'any'}-${maxInterval ?? 'any'} semitones) from note "${previousNote}" within the available pool: [${available.join(', ')}].`);
      }

      const nextNoteIndex = Math.floor(Math.random() * validNextNotes.length);
      const nextNote = validNextNotes[nextNoteIndex];

      newSequence.push(nextNote);
    }

    return newSequence;

  } catch (error) {
      console.error("Error during note sequence generation:", error);
      throw error;
  }
};

export const createPiano = (): Tone.Sampler => {
  const urls = {
      A0: 'A0.mp3', C1: 'C1.mp3', 'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3',
      A1: 'A1.mp3', C2: 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3',
      A2: 'A2.mp3', C3: 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3',
      A3: 'A3.mp3', C4: 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3',
      A4: 'A4.mp3', C5: 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3',
      A5: 'A5.mp3', C6: 'C6.mp3', 'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3',
      A6: 'A6.mp3', C7: 'C7.mp3', 'D#7': 'Ds7.mp3', 'F#7': 'Fs7.mp3',
      A7: 'A7.mp3', C8: 'C8.mp3'
  };

  return new Tone.Sampler({
    urls: urls,
    release: 1,
    baseUrl: 'https://tonejs.github.io/audio/salamander/',
  }).toDestination();
};

export const createMetronome = (): MetronomeInstruments => {
    const metronomeCh = new Tone.Channel({
      volume: -15,
      pan: 0.5
    }).toDestination();

    const metronome = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.1, release: 0.1 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 800,
      octaves: 1.5
    }).connect(metronomeCh);

    const metronomeAccent = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.15, release: 0.2 },
      harmonicity: 3.1,
      modulationIndex: 16,
      resonance: 1000,
      octaves: 1
    }).connect(metronomeCh);

    return { metronome, metronomeAccent };
};

export const createFullSequence = (
    generatedNotes: ReadonlyArray<string>,
    rhythmPattern: ReadonlyArray<RhythmEvent>
): SequenceEvent[] => {
  const fullSequence: SequenceEvent[] = [];
  let noteIndex = 0;
  let currentBeatPosition = 0;

  for (const rhythmItem of rhythmPattern) {
    if (rhythmItem.type === "note") {
        if (noteIndex < generatedNotes.length) {
            fullSequence.push({
                type: "note",
                note: generatedNotes[noteIndex],
                duration: rhythmItem.duration,
                value: rhythmItem.value,
                startTime: currentBeatPosition
            });
            noteIndex++;
        } else {
            console.warn("Rhythm pattern expects more notes than generated. Treating rhythm event as rest at beat:", currentBeatPosition);
             fullSequence.push({
                type: "rest",
                duration: rhythmItem.duration,
                value: rhythmItem.value,
                startTime: currentBeatPosition
            });
        }
    } else if (rhythmItem.type === "rest") {
        fullSequence.push({
            type: "rest",
            duration: rhythmItem.duration,
            value: rhythmItem.value,
            startTime: currentBeatPosition
        });
    }
    currentBeatPosition += rhythmItem.value;
  }

    if (noteIndex < generatedNotes.length) {
        console.warn(`Only used ${noteIndex} out of ${generatedNotes.length} generated notes. Rhythm pattern might be shorter than expected.`);
    }

  return fullSequence;
};

export const createMetronomeEvents = (totalBeats: number): MetronomeEvent[] => {
  const events: MetronomeEvent[] = [];
  const beatsPerMeasure = 4;
  const roundedBeats = Math.ceil(totalBeats);

  for (let i = 0; i < roundedBeats; i++) {
    const beatInMeasure = i % beatsPerMeasure;
    const isAccent = beatInMeasure === 0;
    events.push({
      time: i,
      note: isAccent ? "C5" : "C4",
      velocity: isAccent ? 0.8 : 0.5,
      isAccent: isAccent
    });
  }
  return events;
};

export const playSequence = async ({
  generatedNotes = [],
  fullSequence = [],
  piano,
  metronomeInstruments,
  loop = false,
  bpm = 120,
  onNotePlay,
  onLoopStart,
  onLoopEnd,
  metronomeEvents
}: PlaySequenceOptions): Promise<SequencePlayerControls> => {

  const createInertControls = (notes: string[] = [], sequence: SequenceEvent[] = []): SequencePlayerControls => {
      let inertOnStop: (() => void) | null = null;
      return Object.freeze({
          notes: Object.freeze(notes) as ReadonlyArray<string>,
          fullSequence: Object.freeze(sequence) as ReadonlyArray<SequenceEvent>,
          play: () => { console.warn("Cannot play: Sequence is empty or setup failed."); },
          stop: () => {},
          get isPlaying(): boolean { return false; },
          set onStop(callback: (() => void) | null) { inertOnStop = callback; },
          get onStop(): (() => void) | null { return inertOnStop; }
      });
  };


  if (!piano) {
      console.error("playSequence requires a valid Tone.Sampler instance for 'piano'.");
      return createInertControls(generatedNotes, fullSequence);
  }

  if (Tone.context.state !== "running") {
    console.log("Starting Tone.js AudioContext...");
    try {
      await Tone.start();
      console.log("AudioContext started.");
    } catch (e) {
      console.error("Failed to start AudioContext:", e);
      return createInertControls(generatedNotes, fullSequence);
    }
  }

  Tone.Transport.bpm.value = bpm;

  if (!generatedNotes || generatedNotes.length === 0 || !fullSequence || fullSequence.length === 0) {
    console.warn("playSequence called with empty generatedNotes or fullSequence.");
     return createInertControls(generatedNotes, fullSequence);
  }

  const loopEndTimeSeconds = Tone.Transport.toSeconds(
      Tone.Time(
          fullSequence.reduce((duration, event) => duration + Tone.Time(event.duration).toSeconds(), 0)
      ).toBarsBeatsSixteenths()
  );


  if (loopEndTimeSeconds <= 0) {
     console.warn("playSequence: Calculated sequence duration is zero or negative. Cannot play.");
      return createInertControls(generatedNotes, fullSequence);
  }
  console.log(`Sequence duration calculated as ${loopEndTimeSeconds.toFixed(2)} seconds.`);

  let isPlaying = false;
  let metronomePart: Tone.Part<MetronomeEvent> | null = null;
  let notesPart: Tone.Part<{ time: number; note: string; duration: DurationString; originalIndex: number }> | null = null;
  let loopCount = 0;
  let onStopCallback: (() => void) | null = null;
  let loopStartEventId: number | null = null;
  let endEventId: number | null = null;

  const pianoChannel = new Tone.Channel({ volume: 0, pan: 0 }).toDestination();
  const metronomeChannel = new Tone.Channel({ volume: -15, pan: 0.5 }).toDestination();

  piano.disconnect();
  piano.connect(pianoChannel);

  if (metronomeInstruments) {
    if (metronomeInstruments.metronome) {
      metronomeInstruments.metronome.disconnect();
      metronomeInstruments.metronome.connect(metronomeChannel);
    }
    if (metronomeInstruments.metronomeAccent) {
      metronomeInstruments.metronomeAccent.disconnect();
      metronomeInstruments.metronomeAccent.connect(metronomeChannel);
    }
  }

  const humanizeTime = (timeValue: Tone.Unit.Time): Tone.Unit.Time => {
      const timeInSeconds = Tone.Time(timeValue).toSeconds();
      const variation = (Math.random() * 0.04) - 0.02;
      return Math.max(0, timeInSeconds + variation);
  };
  const humanizeVelocity = (baseVelocity: number): number => {
      const variation = (Math.random() * 0.2) - 0.1;
      return Math.min(1, Math.max(0.1, baseVelocity + variation));
  };
  const humanizeDuration = (baseDuration: DurationString): Tone.Unit.Time => {
      const baseSeconds = Tone.Time(baseDuration).toSeconds();
      const shortening = Math.random() * 0.15;
      const lengthening = Math.random() * 0.05;
      const modification = Math.random() > 0.7 ? lengthening : -shortening;
      const modifiedSeconds = baseSeconds * (1 + modification);
      return Math.max(0.05, modifiedSeconds);
  };

  const play = (): void => {
      if (isPlaying) { console.warn("Transport is already playing."); return; }

      Tone.Transport.cancel(0);
      metronomePart?.dispose(); notesPart?.dispose();
      if (loopStartEventId !== null) Tone.Transport.clear(loopStartEventId);
      if (endEventId !== null) Tone.Transport.clear(endEventId);
      metronomePart = null; notesPart = null; loopStartEventId = null; endEventId = null;
      loopCount = 0; isPlaying = true;

      let finalMetronomeEvents: MetronomeEvent[] | null = null;
      if (metronomeEvents && Array.isArray(metronomeEvents) && metronomeEvents.length > 0) {
          console.log(`Using ${metronomeEvents.length} provided metronomeEvents.`);
          finalMetronomeEvents = metronomeEvents;
      } else {
          const beatsForGeneration = loopEndTimeSeconds * (Tone.Transport.bpm.value / 60);
          const roundedBeatsForGeneration = Math.ceil(beatsForGeneration);
          if (roundedBeatsForGeneration > 0) {
              console.log(`Generating internal metronome events for ${roundedBeatsForGeneration} beats.`);
              finalMetronomeEvents = createMetronomeEvents(roundedBeatsForGeneration);
          } else { console.warn("Cannot generate metronome events: Zero duration."); }
      }

      if (metronomeInstruments && finalMetronomeEvents && finalMetronomeEvents.length > 0) {
          metronomePart = new Tone.Part<MetronomeEvent>((time, event) => {
              const instr = event.isAccent ? metronomeInstruments.metronomeAccent : metronomeInstruments.metronome;
              instr?.triggerAttackRelease(event.note, "64n", time, event.velocity);
          }, finalMetronomeEvents).start(0);
          metronomePart.loop = loop;
          metronomePart.loopEnd = loopEndTimeSeconds;
      } else if (metronomeInstruments) { console.warn("Metronome part not created: No valid events."); }

      const noteEvents = fullSequence
          .filter((item) => item.type === 'note' && item.note)
          .map((item) => ({
              time: item.startTime,
              note: item.note!,
              duration: item.duration,
              originalIndex: fullSequence.findIndex(origItem => origItem === item)
          }));

      notesPart = new Tone.Part<{ time: number; note: string; duration: DurationString; originalIndex: number }>(
          (time, event) => {
              const humanizedTime = humanizeTime(time);
              const humanizedVelocity = humanizeVelocity(0.7);
              const humanizedDuration = humanizeDuration(event.duration);
              piano.triggerAttackRelease(event.note, humanizedDuration, humanizedTime, humanizedVelocity);
              if (onNotePlay) {
                   const noteEventIndex = noteEvents.findIndex(ne => ne.time === event.time && ne.note === event.note && ne.originalIndex === event.originalIndex);
                   const timeInSeconds = Tone.Time(humanizedTime).toSeconds();
                   Tone.Draw.schedule(() => { onNotePlay(timeInSeconds, event.note, noteEventIndex); }, humanizedTime);
              }
          }, noteEvents).start(0);
      notesPart.loop = loop;
      notesPart.loopEnd = loopEndTimeSeconds;

      if (loop) {
          loopStartEventId = Tone.Transport.scheduleRepeat((time) => {
              if (time > 0) loopCount++;
              if (onLoopStart) { Tone.Draw.schedule(() => { onLoopStart(time, loopCount); }, time); }
              if (onLoopEnd) {
                   const loopActualEndTime = time + loopEndTimeSeconds;
                   Tone.Transport.scheduleOnce((endTime) => { Tone.Draw.schedule(() => { onLoopEnd(endTime, loopCount); }, endTime); }, loopActualEndTime - 0.01);
              }
          }, loopEndTimeSeconds, 0);
          if (onLoopStart) { Tone.Transport.scheduleOnce((time) => { Tone.Draw.schedule(() => { onLoopStart(time, loopCount); }, time); }, 0); }
          if (onLoopEnd) { Tone.Transport.scheduleOnce((endTime) => { Tone.Draw.schedule(() => { onLoopEnd(endTime, loopCount); }, endTime); }, loopEndTimeSeconds - 0.01); }
      } else {
          endEventId = Tone.Transport.scheduleOnce(() => { stop(); }, loopEndTimeSeconds + 0.1);
      }

      if (Tone.Transport.state !== "started") { Tone.Transport.start(); }
  };

  const stop = (): void => {
      if (!isPlaying) return;
      notesPart?.stop(0).dispose();
      metronomePart?.stop(0).dispose();
      notesPart = null; metronomePart = null;
      Tone.Transport.stop();
      Tone.Transport.cancel(0);
      if (loopStartEventId !== null) Tone.Transport.clear(loopStartEventId);
      if (endEventId !== null) Tone.Transport.clear(endEventId);
      loopStartEventId = null; endEventId = null;
      isPlaying = false; loopCount = 0;
      if (onStopCallback) { Tone.Draw.schedule(() => { onStopCallback!(); }, Tone.now()); }
  };

  const controls: SequencePlayerControls = {
      notes: Object.freeze([...generatedNotes]) as ReadonlyArray<string>,
      fullSequence: Object.freeze([...fullSequence]) as ReadonlyArray<SequenceEvent>,
      play,
      stop,
      get isPlaying() { return isPlaying; },
      set onStop(callback: (() => void) | null) {
        onStopCallback = callback;
      },
      get onStop(): (() => void) | null {
        return onStopCallback;
      }
  };

  return controls;
};

export const parseDegreeString = (degreeInput: string | null | undefined): string[] | undefined => {
    if (!degreeInput || typeof degreeInput !== 'string' || degreeInput.trim() === '') {
        return undefined;
    }

    const trimmed = degreeInput.trim();

    let content = trimmed;
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        content = trimmed.slice(1, -1);
    }

    if (content.trim() === '') {
         return [];
    }

    const degrees = content.split(',')
                           .map(degree => degree.trim())
                           .filter(degree => degree.length > 0);

    return degrees;
};