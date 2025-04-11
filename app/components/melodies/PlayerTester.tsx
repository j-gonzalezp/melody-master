"use client";
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as Tone from 'tone';
import {
    DurationString,
    RhythmEvent,
    SequenceEvent,
    MetronomeEvent,
    MetronomeInstruments,
    SequencePlayerControls,
    rhythmGenerator,
    generateNoteSequence,
    createPiano,
    createMetronome,
    createFullSequence,
    createMetronomeEvents,
    playSequence,
    GenerateNoteSequenceOptions,
    parseDegreeString,
    RhythmGeneratorOptions,
    PlaySequenceOptions,
    getDegreeFromNote
} from '../../../lib/musicUtils';

import { completeAndGetNextExercise, getFirstExercise, GroupProgressDocument, ExerciseState } from '@/lib/actions/groupProgressActions';
import { calculateAverage } from '@/lib/utils';

import CadencePlayer from '../CadencePlayer';

const degreeRegex = /^(b|#|bb|##)?([1-7])$/;


const getDegreeValue = (degree: string): { number: number; accidentalValue: number } => {
    const match = degree.match(degreeRegex);
    if (!match) return { number: 0, accidentalValue: 0 };
    const accidental = match[1] || '';
    const number = parseInt(match[2], 10);
    let accidentalValue = 0;
    if (accidental === 'b') accidentalValue = -1;
    else if (accidental === 'bb') accidentalValue = -2;
    else if (accidental === '#') accidentalValue = 1;
    else if (accidental === '##') accidentalValue = 2;
    return { number, accidentalValue };
};


interface EligibleExercise { groupID: string; melodyLength: number; bpm: number; }
interface FetchSuccessResponse { success: true; exerciseParams: EligibleExercise; }
interface CompleteSuccessResponseNext { success: true; nextExercise: EligibleExercise; allGraduatedAtLevel?: never; }
interface CompleteSuccessResponseGraduated { success: true; allGraduatedAtLevel: true; level: number; nextExercise?: never; }
interface ErrorResponse { success: false; error: string; }
type FetchResponse = FetchSuccessResponse | ErrorResponse;
type CompleteResponse = CompleteSuccessResponseNext | CompleteSuccessResponseGraduated | ErrorResponse;
type FeedbackStatus = 'correct' | 'incorrect' | 'empty' | 'invalid_format' | null;

const PlayerTester = () => {
    const sectionStyle: React.CSSProperties = { border: '1px solid #ccc', padding: '15px', marginBottom: '15px', borderRadius: '5px', opacity: 1, transition: 'opacity 0.3s ease-in-out' };
    const disabledSectionStyle: React.CSSProperties = { ...sectionStyle, opacity: 0.6, pointerEvents: 'none' };
    const inputBaseStyle: React.CSSProperties = {
        marginRight: '5px', marginBottom: '5px', padding: '5px', width: '50px', textAlign: 'center',
        borderWidth: '1px', borderStyle: 'solid', borderColor: '#ccc',
        borderRadius: '3px', backgroundColor: 'white', color: 'black',
        transition: 'background-color 0.2s ease-in-out, border-color 0.2s ease-in-out'
    };
    const inputContainerStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', marginBottom: '15px' };
    const feedbackInputCorrectStyle: React.CSSProperties = { ...inputBaseStyle, backgroundColor: 'lightgreen', borderColor: 'green' };
    const feedbackInputIncorrectStyle: React.CSSProperties = { ...inputBaseStyle, backgroundColor: 'lightcoral', borderColor: 'darkred' };
    const feedbackInputInvalidFormatStyle: React.CSSProperties = { ...inputBaseStyle, borderColor: 'orange' };
    const preStyle: React.CSSProperties = { background: '#eee', padding: '10px', borderRadius: '3px', maxHeight: '150px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' };
    const errorStyle: React.CSSProperties = { color: 'red', fontWeight: 'bold', marginTop: '10px' };
    const statusStyle: React.CSSProperties = { color: 'blue', fontWeight: 'bold', marginTop: '10px' };
    const loadingStyle: React.CSSProperties = { fontStyle: 'italic', color: 'grey' };
    const graduatedStyle: React.CSSProperties = { color: 'green', fontWeight: 'bold', marginTop: '10px', border: '1px solid green', padding: '10px', borderRadius: '5px' };


    const [totalBeatsInput, setTotalBeatsInput] = useState<string>("4");
    const [shortestDuration, setShortestDuration] = useState<DurationString>('16n');
    const [longestDuration, setLongestDuration] = useState<DurationString>('4n');
    const [allowRests, setAllowRests] = useState<boolean>(true);
    const [restProbabilityInput, setRestProbabilityInput] = useState<string>("0.2");
    const [rangeStart, setRangeStart] = useState<string>('C3');
    const [rangeEnd, setRangeEnd] = useState<string>('C5');
    const [maxIntervalInput, setMaxIntervalInput] = useState<string>("12");
    const [minIntervalInput, setMinIntervalInput] = useState<string>("1");
    const [nNotesInput, setNNotesInput] = useState<string>("");
    const [notesInputConfig, setNotesInputConfig] = useState<string>("");
    const [bpmInput, setBpmInput] = useState<string>("");
    const [keyId, setKeyId] = useState<string>('C');
    const [noteSequenceResult, setNoteSequenceResult] = useState<string[] | null>(null);
    const [rhythmResult, setRhythmResult] = useState<RhythmEvent[] | null>(null);
    const [fullSequenceResult, setFullSequenceResult] = useState<SequenceEvent[] | null>(null);
    const [metronomeEventsResult, setMetronomeEventsResult] = useState<MetronomeEvent[] | null>(null);
    const [parsedDegreesResult, setParsedDegreesResult] = useState<string[] | null>(null);
    const [loopPlayback, setLoopPlayback] = useState<boolean>(false);
    const [toneState, setToneState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [lastPlayedNote, setLastPlayedNote] = useState<string | null>(null);
    const [loopStatus, setLoopStatus] = useState<string>('');
    const [isPlaying, setIsPlaying] = useState(false);
    const [autoPlayNextMelody, setAutoPlayNextMelody] = useState<boolean>(true);
    const [autoPlayDelay, setAutoPlayDelay] = useState<number>(1000);
    const [autoPlayRequested, setAutoPlayRequested] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [isFetching, setIsFetching] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
    const [allGraduatedMessage, setAllGraduatedMessage] = useState<string | null>(null);
    const [amountOfQuestions, setAmountOfQuestions] = useState<number>(5);
    const [inputValues, setInputValues] = useState<string[]>([]);
    const [exerciseScore, setExerciseScore] = useState<number[]>([]);
    const [questionCount, setQuestionCount] = useState<number>(1);
    const [inputValidationStatus, setInputValidationStatus] = useState<FeedbackStatus[]>([]);
    const [firstAttemptScoreStatus, setFirstAttemptScoreStatus] = useState<FeedbackStatus[]>([]);


    const pianoRef = useRef<Tone.Sampler | null>(null);
    const metronomeRef = useRef<MetronomeInstruments | null>(null);
    const playerControlsRef = useRef<SequencePlayerControls | null>(null);
    const isMountedRef = useRef(true);
    const autoPlayTimeoutRef = useRef<NodeJS.Timeout | null>(null);


    useEffect(() => {
        isMountedRef.current = true;
        const initTone = async () => {
            if (toneState !== 'idle') return;
            setToneState('loading'); setError(null); console.log("Initializing Tone.js...");
            try {
                playerControlsRef.current?.stop();
                pianoRef.current?.dispose();
                metronomeRef.current?.metronome?.dispose();
                metronomeRef.current?.metronomeAccent?.dispose();
                pianoRef.current = null; metronomeRef.current = null; playerControlsRef.current = null;
                if (Tone.Transport.state === "started") Tone.Transport.stop();
                Tone.Transport.cancel();

                const piano = createPiano();
                const metronome = createMetronome();
                await Tone.loaded();

                if (isMountedRef.current) {
                    pianoRef.current = piano;
                    metronomeRef.current = metronome;
                    setToneState('ready');
                    console.log("Tone.js ready.");
                } else {
                    piano.dispose();
                    metronome.metronome?.dispose();
                    metronome.metronomeAccent?.dispose();
                    console.log("Tone.js init aborted (component unmounted).");
                }
            } catch (err) {
                console.error("Tone.js init error:", err);
                if (isMountedRef.current) {
                    setError(`Tone Error: ${err instanceof Error ? err.message : String(err)}`);
                    setToneState('error');
                }
            }
        };
        initTone();
        return () => {
            isMountedRef.current = false;
            console.log("Cleaning up PlayerTester Tone.js on unmount...");
            if (autoPlayTimeoutRef.current) clearTimeout(autoPlayTimeoutRef.current);
            playerControlsRef.current?.stop();
            pianoRef.current?.dispose();
            metronomeRef.current?.metronome?.dispose();
            metronomeRef.current?.metronomeAccent?.dispose();
            if (Tone.Transport.state === "started") Tone.Transport.stop();
            Tone.Transport.cancel();
            pianoRef.current = null; metronomeRef.current = null; playerControlsRef.current = null;
            console.log("PlayerTester Tone.js cleaned up.");
        };
    }, []);


    useEffect(() => {
        let isMounted = true;
        const fetchInitialExerciseData = async () => {
            setIsFetching(true); setError(null); setAllGraduatedMessage(null);
            setNoteSequenceResult(null); setRhythmResult(null); setFullSequenceResult(null); setMetronomeEventsResult(null); setParsedDegreesResult(null);
            setNNotesInput(""); setNotesInputConfig(""); setBpmInput(""); setKeyId('C');
            setInputValues([]); setInputValidationStatus([]); setFirstAttemptScoreStatus([]); setExerciseScore([]);
            setQuestionCount(1); setIsEvaluating(false); setIsPlaying(false); setAutoPlayRequested(false);

            const userID = "testuser";
            const context = "major";
            const initialGroupID = "(1,3)";
            const initialLevel = 1;

            try {
                console.log("Fetching first exercise...");
                const response = await getFirstExercise(userID, context, initialGroupID, initialLevel) as FetchResponse;
                if (!isMounted) return;

                if (response.success) {
                    const params = response.exerciseParams;
                    console.log("First exercise data received:", params);
                    setNNotesInput(String(params.melodyLength ?? ''));
                    setNotesInputConfig(params.groupID ?? '');
                    setBpmInput(String(params.bpm ?? ''));
                    setKeyId('C');

                    const numNotes = params.melodyLength ?? 0;
                    setInputValues(Array(numNotes).fill(''));
                    setInputValidationStatus(Array(numNotes).fill(null));
                    setFirstAttemptScoreStatus(Array(numNotes).fill(null));

                } else {
                    console.error("Failed to fetch exercise parameters:", response.error);
                    setError(response.error || "Failed to fetch exercise parameters.");
                }
            } catch (err) {
                console.error("Error fetching initial exercise:", err);
                if (isMounted) setError(err instanceof Error ? err.message : "An unknown error occurred during fetch.");
            } finally {
                if (isMounted) setIsFetching(false);
            }
        };

        if (toneState === 'ready' || (toneState === 'error' && !isFetching)) {
            fetchInitialExerciseData();
        }

        return () => { isMounted = false; };
    }, [toneState]);


    const generateRhythm = useCallback((): RhythmEvent[] | null => {
        try {
            const nNotes = parseInt(nNotesInput, 10);
            const totalBeats = parseInt(totalBeatsInput, 10);
            const restProb = parseFloat(restProbabilityInput);
            if (isNaN(nNotes) || nNotes <= 0 || isNaN(totalBeats) || totalBeats <= 0 || isNaN(restProb) || restProb < 0 || restProb > 1) {
                throw new Error("Invalid rhythm generation parameters.");
            }
            const options: RhythmGeneratorOptions = {
                totalBeats: totalBeats,
                shortestDuration: shortestDuration,
                longestDuration: longestDuration,
                n: nNotes,
                allowRests: allowRests,
                restProbability: restProb
            };
            const result = rhythmGenerator(options);
            if (!result || result.length === 0) throw new Error("Rhythm generation returned empty or null.");
            return result;
        } catch (err) {
            console.error("Error generating rhythm:", err);
            setError(prev => prev ? `${prev} | Rhythm Error: ${err instanceof Error ? err.message : String(err)}` : `Rhythm Error: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    }, [nNotesInput, totalBeatsInput, shortestDuration, longestDuration, allowRests, restProbabilityInput]);

    const generateNotes = useCallback((): { notes: string[] | null, degrees: string[] | null } => {
        try {
            const nNotes = parseInt(nNotesInput, 10);
            const maxInt = parseInt(maxIntervalInput, 10);
            const minInt = parseInt(minIntervalInput, 10);
            if (isNaN(nNotes) || nNotes <= 0 || isNaN(maxInt) || isNaN(minInt) || !keyId || !rangeStart || !rangeEnd || !notesInputConfig) {
                throw new Error("Invalid note generation parameters.");
            }
            const parsedDegreesRaw = parseDegreeString(notesInputConfig);
            if (!Array.isArray(parsedDegreesRaw) || parsedDegreesRaw.some(d => typeof d !== 'string')) {
                throw new Error(`Failed to parse degrees: '${notesInputConfig}'. Result was not an array of strings.`);
            }
            const parsedDegreesStr = parsedDegreesRaw as string[];
            if (parsedDegreesStr.length === 0) {
                throw new Error(`Parsing degrees '${notesInputConfig}' resulted in an empty array.`);
            }

            const sequenceOptions: GenerateNoteSequenceOptions = {
                keyId: keyId,
                notes: parsedDegreesStr,
                range: [rangeStart, rangeEnd],
                numberOfNotes: nNotes,
                maxInterval: maxInt,
                minInterval: minInt,
            };
            const generatedNotes = generateNoteSequence(sequenceOptions);
            if (!generatedNotes || generatedNotes.length === 0) throw new Error("Note sequence generation returned empty or null.");
            return { notes: generatedNotes, degrees: parsedDegreesStr };
        } catch (err) {
            console.error("Error generating notes:", err);
            setError(prev => prev ? `${prev} | Notes Error: ${err instanceof Error ? err.message : String(err)}` : `Notes Error: ${err instanceof Error ? err.message : String(err)}`);
            return { notes: null, degrees: null };
        }
    }, [notesInputConfig, nNotesInput, keyId, rangeStart, rangeEnd, maxIntervalInput, minIntervalInput]);

    const combineSequenceAndMetronome = useCallback((notes: string[], rhythm: RhythmEvent[]): { fullSeq: SequenceEvent[] | null, metroEvents: MetronomeEvent[] | null } => {
        try {
            const fullSeq = createFullSequence(notes, rhythm);
            if (!fullSeq || fullSeq.length === 0) throw new Error("Combining notes and rhythm failed.");

            let metroEvents: MetronomeEvent[] | null = null;
            const bpm = parseInt(bpmInput, 10);
            if (!isNaN(bpm) && bpm > 0) {
                try {
                    const totalSeconds = fullSeq.reduce((time, event) => time + Tone.Time(event.duration).toSeconds(), 0);
                    const totalSequenceBeats = totalSeconds * (bpm / 60);
                    if (totalSequenceBeats > 0) {
                        metroEvents = createMetronomeEvents(Math.ceil(totalSequenceBeats));
                    }
                } catch (calcError) {
                    console.error("Error calculating duration/metronome events:", calcError);
                    setError(prev => prev ? `${prev} | Metro Calc Err` : `Metro Calc Err`);
                }
            }

            return { fullSeq, metroEvents };
        } catch (err) {
            console.error("Error combining sequence:", err);
            setError(prev => prev ? `${prev} | Combine Error: ${err instanceof Error ? err.message : String(err)}` : `Combine Error: ${err instanceof Error ? err.message : String(err)}`);
            return { fullSeq: null, metroEvents: null };
        }
    }, [bpmInput]);


    const generateFullExercise = useCallback(async (): Promise<boolean> => {
        if (isGenerating || isFetching) {
            console.log("Generation skipped: already generating or fetching.");
            return false;
        }
        setIsGenerating(true); setError(null); setAllGraduatedMessage(null);
        setNoteSequenceResult(null); setRhythmResult(null); setFullSequenceResult(null); setMetronomeEventsResult(null); setParsedDegreesResult(null);
        console.log("Generating new exercise sequence...");

        try {
            const generatedRhythm = generateRhythm();
            if (!generatedRhythm) throw new Error("Rhythm generation failed.");

            const { notes: generatedNotes, degrees: parsedDegs } = generateNotes();
            if (!generatedNotes || !parsedDegs) throw new Error("Note generation failed.");

            const { fullSeq: combinedSeq, metroEvents: createdMetroEvents } = combineSequenceAndMetronome(generatedNotes, generatedRhythm);
            if (!combinedSeq) throw new Error("Sequence combination failed.");

            setRhythmResult(generatedRhythm);
            setNoteSequenceResult(generatedNotes);
            setParsedDegreesResult(parsedDegs);
            setFullSequenceResult(combinedSeq);
            setMetronomeEventsResult(createdMetroEvents);

            console.log("Full exercise generation successful.");
            setIsGenerating(false);
            return true;

        } catch (err) {
            console.error("Error generating full exercise:", err);
            setError(prev => prev ? `${prev} | Generation failed: ${err instanceof Error ? err.message : String(err)}` : `Generation failed: ${err instanceof Error ? err.message : String(err)}`);
            setIsGenerating(false);
            return false;
        }
    }, [isGenerating, isFetching, generateRhythm, generateNotes, combineSequenceAndMetronome]);


    useEffect(() => {
        const nNotes = parseInt(nNotesInput, 10);
        const bpm = parseInt(bpmInput, 10);
        const paramsValid = nNotesInput && !isNaN(nNotes) && nNotes > 0 &&
            notesInputConfig &&
            bpmInput && !isNaN(bpm) && bpm > 0 &&
            keyId && rangeStart && rangeEnd;

        if (paramsValid && !isFetching && !isGenerating && toneState === 'ready' && !noteSequenceResult && !fullSequenceResult && !allGraduatedMessage && !isEvaluating) {
            console.log("Params valid & ready, triggering auto-generation...");
            generateFullExercise();
        }
    }, [nNotesInput, notesInputConfig, bpmInput, keyId, rangeStart, rangeEnd, isFetching, isGenerating, toneState, noteSequenceResult, fullSequenceResult, allGraduatedMessage, isEvaluating, generateFullExercise]);


    const handlePlay = useCallback(async () => {
        if (!isMountedRef.current) { console.log("Play aborted: Component unmounted"); return; }

        setError(null); setLastPlayedNote(null); setLoopStatus('');

        if (isPlaying || isGenerating || toneState !== 'ready' || !pianoRef.current || !metronomeRef.current || allGraduatedMessage || !fullSequenceResult || !noteSequenceResult) {
            console.log("Play prevented:", { isPlaying, isGenerating, toneState, hasPiano: !!pianoRef.current, hasMetro: !!metronomeRef.current, graduated: !!allGraduatedMessage, hasFullSeq: !!fullSequenceResult, hasNoteSeq: !!noteSequenceResult });
            if (toneState === 'ready' && !isGenerating && !fullSequenceResult && !noteSequenceResult && !allGraduatedMessage) {
                console.warn("Play prevented due to missing sequence, attempting regeneration...");
                generateFullExercise();
            }
            return;
        }

        const currentBpm = parseInt(bpmInput, 10);
        if (isNaN(currentBpm) || currentBpm <= 0) {
            setError(`Invalid BPM: ${bpmInput}`);
            return;
        }

        console.log("Attempting to start main sequence playback...");
        setIsPlaying(true);
        setLastPlayedNote('Playback starting...');

        try {
            await Tone.start();
            if (Tone.context.state !== 'running') {
                throw new Error("AudioContext failed to start. Please interact with the page.");
            }

            playerControlsRef.current?.stop();
            if (Tone.Transport.state === 'started') {
                Tone.Transport.stop();
            }
            Tone.Transport.cancel();

            Tone.Transport.bpm.value = currentBpm;
            Tone.Transport.seconds = 0;

            const playOptions: PlaySequenceOptions = {
                fullSequence: fullSequenceResult,
                generatedNotes: noteSequenceResult,
                piano: pianoRef.current,
                metronomeInstruments: metronomeRef.current,
                metronomeEvents: metronomeEventsResult ?? undefined,
                loop: loopPlayback,
                bpm: currentBpm,
                onNotePlay: (time, note, index) => {
                    if (!isMountedRef.current) return;
                    Tone.Draw.schedule(() => {
                        setLastPlayedNote(`Note: ${note} (idx: ${index})`);
                    }, time);
                },
                onLoopStart: (time, count) => {
                    if (!isMountedRef.current) return;
                    Tone.Draw.schedule(() => {
                        setLoopStatus(`Loop ${count + 1} started`);
                    }, time);
                },
                onLoopEnd: (time, count) => {
                    if (!isMountedRef.current) return;
                    Tone.Draw.schedule(() => {
                        setLoopStatus(`Loop ${count + 1} ended`);
                    }, time);
                },
            };

            const controls = await playSequence(playOptions);
            playerControlsRef.current = controls;

            controls.onStop = () => {
                queueMicrotask(() => {
                    if (isMountedRef.current && playerControlsRef.current === controls) {
                        console.log("Main sequence stopped via onStop callback.");
                        setIsPlaying(false);
                        playerControlsRef.current = null;
                        setLastPlayedNote('Playback stopped.');
                        setLoopStatus(prev => prev ? `${prev} | Stopped.` : 'Stopped.');
                    } else {
                        console.log("onStop callback ignored (stale control or unmounted).");
                    }
                });
            };

            controls.play();

        } catch (err) {
            console.error("Error during handlePlay:", err);
            setError(`Play Error: ${err instanceof Error ? err.message : String(err)}`);
            setIsPlaying(false);
            playerControlsRef.current?.stop();
            playerControlsRef.current = null;
            if (Tone.Transport.state === "started") {
                Tone.Transport.stop();
                Tone.Transport.cancel();
            }
        }
    }, [
        isPlaying, isGenerating, toneState, allGraduatedMessage, fullSequenceResult, noteSequenceResult, bpmInput,
        metronomeEventsResult, loopPlayback, pianoRef, metronomeRef,
        generateFullExercise, setError, setLastPlayedNote, setLoopStatus, setIsPlaying
    ]);


    const handleStop = useCallback(() => {
        console.log("handleStop called for main sequence.");
        if (autoPlayTimeoutRef.current) {
            clearTimeout(autoPlayTimeoutRef.current);
            autoPlayTimeoutRef.current = null;
            setAutoPlayRequested(false);
            console.log("Cleared pending auto-play timeout on manual stop.");
        }

        if (playerControlsRef.current) {
            console.log("Stopping main sequence via playerControlsRef.current.stop()");
            playerControlsRef.current.stop();
        }
        else if (Tone.Transport.state === 'started') {
            console.log("Stopping main sequence via Tone.Transport.stop() (fallback)");
            Tone.Transport.stop();
            Tone.Transport.cancel();
            if (isPlaying) setIsPlaying(false);
        }
        else {
            console.log("handleStop: No active main sequence playback found to stop.");
            if (isPlaying) setIsPlaying(false);
        }
    }, [isPlaying]);


    useEffect(() => {
        const numNotes = parseInt(nNotesInput, 10);
        if (!isNaN(numNotes) && numNotes > 0) {
            if (inputValues.length !== numNotes) {
                setInputValues(Array(numNotes).fill(''));
                setInputValidationStatus(Array(numNotes).fill(null));
                setFirstAttemptScoreStatus(Array(numNotes).fill(null));
            }
        } else if (inputValues.length > 0) {
            setInputValues([]);
            setInputValidationStatus([]);
            setFirstAttemptScoreStatus([]);
        }
    }, [nNotesInput]);


    const handleInputChange = useCallback((index: number, event: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = event.target.value;
        const trimmedValue = newValue.trim();

        setInputValues(prev => {
            const next = [...prev];
            next[index] = newValue;
            return next;
        });

        let currentCorrectness: FeedbackStatus = null;
        let validationStatusForUI: FeedbackStatus = null;

        if (trimmedValue === '') {
            validationStatusForUI = null;
        } else {
            const isValidFormat = degreeRegex.test(trimmedValue);
            if (!isValidFormat) {
                validationStatusForUI = 'invalid_format';
            } else if (noteSequenceResult && keyId && index < noteSequenceResult.length) {
                try {
                    const expectedNote = noteSequenceResult[index];
                    const expectedDegree = getDegreeFromNote(expectedNote, keyId);
                    const normalizedInput = trimmedValue;
                    const normalizedExpected = expectedDegree;

                    currentCorrectness = (normalizedInput === normalizedExpected) ? 'correct' : 'incorrect';
                    validationStatusForUI = currentCorrectness;
                } catch (err) {
                    console.error(`Error processing input for note at index ${index} in key ${keyId}:`, err);
                    currentCorrectness = 'incorrect';
                    validationStatusForUI = 'incorrect';
                    setError(prev => prev ? `${prev} | Err valid ${index + 1}` : `Err valid ${index + 1}`);
                }
            } else {
                validationStatusForUI = null;
            }
        }

        setInputValidationStatus(prev => {
            const next = [...prev];
            next[index] = validationStatusForUI;
            return next;
        });

        if (currentCorrectness === 'correct' || currentCorrectness === 'incorrect') {
            setFirstAttemptScoreStatus(prevScore => {
                const nextScore = [...prevScore];
                if (nextScore[index] === null) {
                    nextScore[index] = currentCorrectness;
                }
                return nextScore;
            });
        }

    }, [noteSequenceResult, keyId, setError, setInputValues, setInputValidationStatus, setFirstAttemptScoreStatus]);


    const handleNext = useCallback(async () => {
        if (isEvaluating || allGraduatedMessage || !isMountedRef.current) {
            console.log("handleNext prevented:", { isEvaluating, allGraduatedMessage, isMounted: isMountedRef.current });
            return;
        }
        console.log("Next button pressed.");

        if (autoPlayTimeoutRef.current) clearTimeout(autoPlayTimeoutRef.current);
        autoPlayTimeoutRef.current = null;
        setAutoPlayRequested(false);

        handleStop();
        setIsEvaluating(true);
        setError(null);

        let correctFirstAttempts = 0;
        const numExpectedNotes = noteSequenceResult?.length ?? 0;
        if (numExpectedNotes > 0) {
            const relevantScores = firstAttemptScoreStatus.slice(0, numExpectedNotes);
            correctFirstAttempts = relevantScores.filter(status => status === 'correct').length;
        }
        const currentQuestionScore = numExpectedNotes > 0 ? (correctFirstAttempts / numExpectedNotes) * 100 : 0;
        const updatedScores = [...exerciseScore, currentQuestionScore];
        setExerciseScore(updatedScores);
        console.log(`--- Question ${questionCount} Finished | Score: ${currentQuestionScore.toFixed(1)}% (${correctFirstAttempts}/${numExpectedNotes}) ---`);
        console.log(`First Attempt Status at end of Q${questionCount}:`, JSON.stringify(firstAttemptScoreStatus.slice(0, numExpectedNotes)));

        if (questionCount < amountOfQuestions) {
            console.log("Moving to next question...");
            setQuestionCount(prev => prev + 1);

            const numNotes = parseInt(nNotesInput, 10);
            const resetSize = !isNaN(numNotes) && numNotes > 0 ? numNotes : 0;
            setInputValues(Array(resetSize).fill(''));
            setInputValidationStatus(Array(resetSize).fill(null));
            setFirstAttemptScoreStatus(Array(resetSize).fill(null));
            setLastPlayedNote(null); setLoopStatus('');

            const generationSuccess = await generateFullExercise();

            if (isMountedRef.current) setIsEvaluating(false);

            if (generationSuccess && isMountedRef.current) {
                console.log("New exercise generated successfully for next question.");
                const newNumNotes = noteSequenceResult?.length ?? 0;
                if (newNumNotes !== resetSize && newNumNotes > 0) {
                    console.warn(`Melody length mismatch after regeneration (${newNumNotes} vs ${resetSize}). Adjusting inputs.`);
                    setInputValues(Array(newNumNotes).fill(''));
                    setInputValidationStatus(Array(newNumNotes).fill(null));
                    setFirstAttemptScoreStatus(Array(newNumNotes).fill(null));
                } else if (newNumNotes === 0 && resetSize > 0) {
                    console.error(`Generation succeeded but resulted in empty sequence? Input size was ${resetSize}`);
                    setError(prev => prev ? `${prev} | Gen Err Q${questionCount + 1} (empty)` : `Gen Err Q${questionCount + 1} (empty)`);
                    setInputValues([]); setInputValidationStatus([]); setFirstAttemptScoreStatus([]);
                }

                if (autoPlayNextMelody) {
                    console.log(`Scheduling auto-play request with delay: ${autoPlayDelay}ms`);
                    if (autoPlayTimeoutRef.current) clearTimeout(autoPlayTimeoutRef.current);
                    autoPlayTimeoutRef.current = setTimeout(() => {
                        if (isMountedRef.current) {
                            console.log("Auto-play timeout fired. Setting request flag.");
                            setAutoPlayRequested(true);
                            autoPlayTimeoutRef.current = null;
                        } else { console.log("Auto-play timeout aborted: Component unmounted."); }
                    }, autoPlayDelay);
                }
            } else if (!generationSuccess && isMountedRef.current) {
                setError(prev => prev ? `${prev} | Gen Error Q${questionCount + 1}` : `Gen Error Q${questionCount + 1}`);
                setInputValues([]); setInputValidationStatus([]); setFirstAttemptScoreStatus([]);
            }

        } else {
            console.log(`Final question finished for this set (Group: ${notesInputConfig}, Length: ${nNotesInput}). Submitting results.`);
            try {
                const finalAverageScore100 = calculateAverage(updatedScores);
                const finalAccuracy01 = finalAverageScore100 / 100;
                console.log(`Final Average Accuracy for Set: ${finalAccuracy01.toFixed(3)} (${finalAverageScore100.toFixed(1)}%)`);

                const userID = "testuser";
                const context = "major";
                const completedGroupId = notesInputConfig;
                const completedMelodyLength = parseInt(nNotesInput, 10);

                if (isNaN(completedMelodyLength) || !completedGroupId) {
                    throw new Error("Invalid parameters for completing exercise (groupID or melodyLength missing/invalid).");
                }

                const result = await completeAndGetNextExercise(
                    userID,
                    context,
                    completedGroupId,
                    completedMelodyLength,
                    finalAccuracy01
                ) as CompleteResponse;

                if (!isMountedRef.current) return;

                if (result.success) {
                    if (result.nextExercise) {
                        const nextParams = result.nextExercise;
                        console.log("Received next exercise parameters:", nextParams);
                        setNNotesInput(String(nextParams.melodyLength ?? ''));
                        setNotesInputConfig(nextParams.groupID ?? '');
                        setBpmInput(String(nextParams.bpm ?? ''));
                        setKeyId('C');
                        setQuestionCount(1);
                        setExerciseScore([]);
                        const numNotes = nextParams.melodyLength ?? 0;
                        setInputValues(Array(numNotes).fill(''));
                        setInputValidationStatus(Array(numNotes).fill(null));
                        setFirstAttemptScoreStatus(Array(numNotes).fill(null));
                        setNoteSequenceResult(null); setRhythmResult(null); setFullSequenceResult(null); setMetronomeEventsResult(null); setParsedDegreesResult(null);
                        setLastPlayedNote("New exercise loaded. Generating melody...");
                        setAllGraduatedMessage(null);

                        if (autoPlayNextMelody) {
                            console.log(`Scheduling auto-play request for the NEW exercise set with delay: ${autoPlayDelay}ms`);
                            if (autoPlayTimeoutRef.current) clearTimeout(autoPlayTimeoutRef.current);
                            autoPlayTimeoutRef.current = setTimeout(() => {
                                if (isMountedRef.current) {
                                    console.log("Auto-play timeout fired for new exercise set. Setting request flag.");
                                    setAutoPlayRequested(true);
                                    autoPlayTimeoutRef.current = null;
                                } else {
                                    console.log("Auto-play timeout aborted for new set: Component unmounted.");
                                }
                            }, autoPlayDelay);
                        }

                    } else if (result.allGraduatedAtLevel) {
                        console.log(`All exercises graduated at level ${result.level}.`);
                        setAllGraduatedMessage(`Congratulations! You've mastered all exercises at level ${result.level}.`);
                        setNoteSequenceResult(null); setRhythmResult(null); setFullSequenceResult(null); setMetronomeEventsResult(null); setParsedDegreesResult(null);
                    }
                } else {
                    console.error("API Error getting next exercise:", result.error);
                    setError(`API Error: ${result.error || "Failed to get next exercise."}`);
                }
            } catch (err) {
                console.error("Error during final submission / fetching next exercise:", err);
                if (isMountedRef.current) setError(`Submission Error: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
                if (isMountedRef.current) setIsEvaluating(false);
            }
        }
    }, [
        isEvaluating, allGraduatedMessage, noteSequenceResult, firstAttemptScoreStatus, exerciseScore, questionCount, amountOfQuestions,
        notesInputConfig, nNotesInput, autoPlayNextMelody, autoPlayDelay,
        handleStop, generateFullExercise, calculateAverage, completeAndGetNextExercise,
        setNNotesInput, setNotesInputConfig, setBpmInput, setKeyId, setQuestionCount, setExerciseScore,
        setInputValues, setInputValidationStatus, setFirstAttemptScoreStatus, setNoteSequenceResult, setRhythmResult,
        setFullSequenceResult, setMetronomeEventsResult, setParsedDegreesResult, setLastPlayedNote, setAllGraduatedMessage,
        setIsEvaluating, setError, setLoopStatus, setAutoPlayRequested
    ]);


    useEffect(() => {
        if (!autoPlayRequested) return;

        const canAutoPlay = !isPlaying &&
            !isEvaluating &&
            toneState === 'ready' &&
            !!noteSequenceResult &&
            !!fullSequenceResult &&
            !allGraduatedMessage;

        if (canAutoPlay) {
            console.log("Auto-play request detected and conditions met. Calling handlePlay.");
            setAutoPlayRequested(false);
            handlePlay();
        } else {
            console.log("Auto-play requested but conditions not met:", {
                autoPlayRequested,
                isPlaying,
                isEvaluating,
                isReady: toneState === 'ready',
                hasSequence: !!noteSequenceResult && !!fullSequenceResult,
                graduated: !!allGraduatedMessage
            });
            setAutoPlayRequested(false);
        }
    }, [autoPlayRequested]);


    const handleCadenceComplete = useCallback(() => {
        console.log("PlayerTester: Cadence finished playing!");
    }, []);


    const dynamicInputs = useMemo(() => {
        const numNotesParam = parseInt(nNotesInput, 10);

        if (isNaN(numNotesParam) || numNotesParam <= 0) {
            return <p style={loadingStyle}>{isFetching ? "Fetching exercise..." : "Waiting for exercise parameters..."}</p>;
        }
        if (isGenerating && !noteSequenceResult) {
            return <p style={loadingStyle}>Generating melody...</p>;
        }
        if (!noteSequenceResult && !isGenerating && !isFetching && toneState === 'ready') {
            return <p style={loadingStyle}>Preparing exercise...</p>;
        }
        if (!noteSequenceResult) {
            return <p style={loadingStyle}>Loading melody data...</p>;
        }
        if (noteSequenceResult && noteSequenceResult.length === 0) {
            return <p style={errorStyle}>Error: Melody generation resulted in 0 notes.</p>;
        }

        const actualNumNotes = noteSequenceResult?.length ?? 0;

        if (numNotesParam !== actualNumNotes && actualNumNotes > 0) {
            console.warn(`Input count mismatch: Parameter requested ${numNotesParam}, but generated sequence has ${actualNumNotes}. Rendering ${actualNumNotes} inputs.`);
        }

        if (actualNumNotes === 0) {
            return <p style={errorStyle}>Cannot display inputs: No notes in the generated sequence.</p>;
        }

        return Array.from({ length: actualNumNotes }).map((_, index) => {
            let currentStyle = inputBaseStyle;
            const validationStatus = inputValidationStatus[index];

            switch (validationStatus) {
                case 'correct': currentStyle = feedbackInputCorrectStyle; break;
                case 'incorrect': currentStyle = feedbackInputIncorrectStyle; break;
                case 'invalid_format': currentStyle = feedbackInputInvalidFormatStyle; break;
            }

            const isInputDisabled = isEvaluating || !!allGraduatedMessage;

            return (
                <input
                    key={`input-${index}`}
                    type="text"
                    value={inputValues[index] ?? ''}
                    onChange={(event) => handleInputChange(index, event)}
                    placeholder={`${index + 1}`}
                    style={currentStyle}
                    disabled={isInputDisabled}
                    aria-label={`Scale degree input ${index + 1}`}
                    autoComplete="off"
                />
            );
        });
    }, [nNotesInput, inputValues, inputValidationStatus, handleInputChange, isEvaluating, noteSequenceResult, allGraduatedMessage, isGenerating, isFetching, toneState]);


    const sortedUniqueDegrees = useMemo(() => {
        if (!notesInputConfig) return [];
        try {
            const degrees = parseDegreeString(notesInputConfig);
            if (!Array.isArray(degrees) || !degrees.every(d => typeof d === 'string')) {
                console.error("Parsed degrees are not an array of strings:", degrees);
                return [];
            }
            const uniqueDegrees = [...new Set(degrees as string[])];

            uniqueDegrees.sort((a, b) => {
                const valA = getDegreeValue(a);
                const valB = getDegreeValue(b);
                if (valA.number !== valB.number) {
                    return valA.number - valB.number;
                }
                return valA.accidentalValue - valB.accidentalValue;
            });
            return uniqueDegrees;
        } catch (e) {
            console.error("Error parsing/sorting group ID degrees for display:", e);
            return [];
        }
    }, [notesInputConfig]);


    const handleDegreeButtonClick = useCallback((degree: string) => {
        const nextEmptyIndex = inputValues.findIndex(val => val === '');

        if (nextEmptyIndex !== -1) {
            const syntheticEvent = {
                target: { value: degree }
            } as React.ChangeEvent<HTMLInputElement>;
            handleInputChange(nextEmptyIndex, syntheticEvent);
        } else {
            console.log("No empty input slot found for degree button click.");
        }
    }, [inputValues, handleInputChange]);


    const isReady = toneState === 'ready';
    const isLoading = toneState === 'loading' || isFetching || isGenerating;
    const canProceedToNext = !isEvaluating &&
        !!noteSequenceResult &&
        noteSequenceResult.length > 0 &&
        firstAttemptScoreStatus.length >= noteSequenceResult.length &&
        firstAttemptScoreStatus.slice(0, noteSequenceResult.length).every(status => status === 'correct' || status === 'incorrect') &&
        !allGraduatedMessage;

    const isInteractionDisabled = !isReady || isLoading || isEvaluating || !!allGraduatedMessage;
    const playButtonDisabledCondition = isInteractionDisabled || (!noteSequenceResult || !fullSequenceResult);
    const isPlayButtonDisabled = isPlaying ? false : playButtonDisabledCondition;

    const allInputsFilled = useMemo(() => {
        const expectedLength = noteSequenceResult?.length ?? 0;
        if (expectedLength === 0) return true;
        return inputValues.slice(0, expectedLength).every(val => val !== '');
    }, [inputValues, noteSequenceResult]);

    const cadenceBpm = useMemo(() => {
        const parsed = parseInt(bpmInput, 10);
        return isNaN(parsed) || parsed <= 0 ? 120 : parsed;
    }, [bpmInput]);


    return (
        <div>
            <h1>Scale Degree Ear Trainer</h1>
            <div>Tone State: {toneState} {isLoading && <span style={loadingStyle}>(Loading...)</span>}</div>
            {isEvaluating && <div style={loadingStyle}>{questionCount < amountOfQuestions ? 'Processing score...' : 'Submitting results...'}</div>}
            {isGenerating && !isEvaluating && <div style={loadingStyle}>Generating melody...</div>}
            {error && <div style={errorStyle}>Error: {error}</div>}
            {lastPlayedNote && <div style={statusStyle}>Status: {lastPlayedNote}</div>}
            {loopStatus && <div style={statusStyle}>Loop: {loopStatus}</div>}
            {allGraduatedMessage && <div style={graduatedStyle}>{allGraduatedMessage}</div>}

            <div style={isInteractionDisabled ? disabledSectionStyle : sectionStyle}>
                <h2>Exercise: Question {questionCount} of {amountOfQuestions}</h2>
                <p>Listen, then enter scale degrees (e.g., 1, b3, #5).</p>
                {/*<div className="hidden" style={{ marginBottom: '10px', fontSize: '0.9em', color: '#555' }}>
                   Target: {nNotesInput || '?'} notes | Group: {notesInputConfig || '?'} ({sortedUniqueDegrees.join(', ')}) | BPM: {bpmInput || '?'} | Key: {keyId || '?'}
                </div>
*/ }
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
                    <button
                        onClick={isPlaying ? handleStop : handlePlay}
                        disabled={isPlayButtonDisabled}
                        style={{ minWidth: '120px', marginRight: '10px', marginBottom: '5px' }}
                    >
                        {isPlaying ? "Stop Melody" : "Play Melody"}
                    </button>
                    <label style={{ marginRight: '15px', marginBottom: '5px', display: 'inline-flex', alignItems: 'center' }}>
                        <input
                            type="checkbox"
                            checked={loopPlayback}
                            onChange={(e) => setLoopPlayback(e.target.checked)}
                            disabled={isPlaying || isInteractionDisabled}
                            style={{ marginRight: '4px' }}
                        /> Loop
                    </label>

                    {isReady && (
                        <div style={{ marginRight: '10px', marginBottom: '5px', display: 'inline-block' }}>
                            <CadencePlayer
                                musicalKey={keyId}
                                bpm={cadenceBpm}
                                pianoInstrument={pianoRef.current}
                                onCadenceComplete={handleCadenceComplete}
                                disabled={isInteractionDisabled || isPlaying}
                            />
                        </div>
                    )}
                </div>

                <div style={{ marginTop: '10px' }}>
                    <label style={{ marginRight: '15px', display: 'inline-flex', alignItems: 'center' }}>
                        <input
                            type="checkbox"
                            checked={autoPlayNextMelody}
                            onChange={(e) => setAutoPlayNextMelody(e.target.checked)}
                            disabled={isInteractionDisabled}
                            style={{ marginRight: '4px' }}
                        />
                        Auto-play next melody
                    </label>
                    <label style={{ display: 'inline-flex', alignItems: 'center' }}> Delay:
                        <input
                            type="number"
                            value={autoPlayDelay / 1000}
                            onChange={(e) => setAutoPlayDelay(Math.max(100, Number(e.target.value) * 1000))}
                            disabled={!autoPlayNextMelody || isInteractionDisabled}
                            min="0.1" max="10" step="0.1"
                            style={{ width: '60px', marginLeft: '5px', padding: '3px' }}
                        /> seconds
                    </label>
                </div>


                <div style={{ marginTop: '20px' }}>
                    <h3>Your Answer:</h3>

                    <div style={{ marginTop: '5px', marginBottom: '10px' }}>
                        {sortedUniqueDegrees.length > 0 && <span style={{ marginRight: '10px', fontSize: '0.9em', color: '#333' }}>Quick Input:</span>}
                        {sortedUniqueDegrees.map(degree => (
                            <button
                                key={`degree-btn-${degree}`}
                                onClick={() => handleDegreeButtonClick(degree)}
                                disabled={isInteractionDisabled || allInputsFilled}
                                style={{
                                    marginRight: '5px',
                                    marginBottom: '5px',
                                    padding: '4px 8px',
                                    fontSize: '0.9em',
                                    cursor: (isInteractionDisabled || allInputsFilled) ? 'not-allowed' : 'pointer'
                                }}
                                title={`Fill next empty input with ${degree}`}
                            >
                                {degree}
                            </button>
                        ))}
                        {sortedUniqueDegrees.length > 0 && allInputsFilled && !isInteractionDisabled &&
                            <span style={{ fontSize: '0.8em', color: 'grey', marginLeft: '10px' }}>(All inputs filled)</span>
                        }
                    </div>

                    <div style={inputContainerStyle}>
                        {dynamicInputs}
                    </div>
                    {inputValidationStatus.includes('invalid_format') && !isEvaluating &&
                        <p style={{ color: 'orange', fontSize: '0.8em', marginTop: '-10px', marginBottom: '10px' }}>Use format like '1', 'b3', '#5'.</p>}
                </div>


                <button
                    onClick={handleNext}
                    disabled={!canProceedToNext || isInteractionDisabled}
                    style={{ marginTop: '15px', fontWeight: 'bold', padding: '8px 15px' }}
                >
                    {isEvaluating
                        ? "Processing..."
                        : (questionCount < amountOfQuestions
                            ? `Next Question (${questionCount + 1}/${amountOfQuestions})`
                            : "Finish & Get Next Exercise")}
                </button>


                {exerciseScore.length > 0 && (
                    <div style={{ marginTop: '15px', borderTop: '1px dashed #ccc', paddingTop: '10px', fontSize: '0.9em' }}>
                        <strong>Scores:</strong> {exerciseScore.map((s, i) => (
                            <span key={i} style={{ marginLeft: '5px', fontWeight: i === exerciseScore.length - 1 ? 'bold' : 'normal' }}>
                                {`Q${i + 1}: ${s.toFixed(0)}%`}
                            </span>
                        ))}
                        {exerciseScore.length === amountOfQuestions && !isEvaluating && questionCount > amountOfQuestions &&
                            <span style={{ marginLeft: '5px', fontWeight: 'bold' }}> | Avg: {(calculateAverage(exerciseScore)).toFixed(1)}%</span>
                        }
                    </div>
                )}
            </div>

            <details style={{ marginTop: '20px' }}>
                <summary>Debug Info</summary>
                <div style={{ ...sectionStyle, fontSize: '0.8em', maxHeight: '400px', overflowY: 'auto' }}>
                    <p><strong>State:</strong> Tone: {toneState} | Playing Main: {String(isPlaying)} | Evaluating: {String(isEvaluating)} | Generating: {String(isGenerating)} | Fetching: {String(isFetching)}</p>
                    <p><strong>Flags:</strong> AutoPlay Requested: {String(autoPlayRequested)} | Graduated Msg: {allGraduatedMessage ? 'Yes' : 'No'} | Mounted: {String(isMountedRef.current)}</p>
                    <p><strong>Controls:</strong> Can Proceed: {String(canProceedToNext)} | Interaction Disabled: {String(isInteractionDisabled)} | Play/Stop Button Disabled: {String(isPlayButtonDisabled)} | All Inputs Filled: {String(allInputsFilled)}</p>
                    <p><strong>Refs:</strong> Player Controls: {playerControlsRef.current ? 'Exists' : 'null'} | Piano: {pianoRef.current ? 'Exists' : 'null'} | Metronome: {metronomeRef.current ? 'Exists' : 'null'} | AutoPlay Timeout: {autoPlayTimeoutRef.current ? 'Exists' : 'null'}</p>
                    <p><strong>Exercise Params:</strong> Notes: {nNotesInput} | Group: {notesInputConfig} | BPM: {bpmInput} | Key: {keyId}</p>
                    <p><strong>Derived:</strong> Sorted Unique Degrees: {JSON.stringify(sortedUniqueDegrees)} | Cadence Parsed BPM: {cadenceBpm}</p>
                    <p><strong>Target Notes (Debug):</strong> <code style={preStyle}>{JSON.stringify(noteSequenceResult)}</code></p>
                    <p><strong>Input Values:</strong> <code style={preStyle}>{JSON.stringify(inputValues)}</code></p>
                    <p><strong>Input Visual Status:</strong> <code style={preStyle}>{JSON.stringify(inputValidationStatus)}</code></p>
                    <p><strong>First Attempt Recorded:</strong> <code style={preStyle}>{JSON.stringify(firstAttemptScoreStatus)}</code></p>
                    <p><strong>Question Scores:</strong> <code style={preStyle}>{JSON.stringify(exerciseScore)}</code></p>
                    <p><strong>Rhythm Durations:</strong> <code style={preStyle}>{JSON.stringify(rhythmResult?.map(r => r.duration))}</code></p>
                    <p><strong>Full Sequence Events:</strong> <code style={preStyle}>{JSON.stringify(fullSequenceResult)}</code></p>
                    <p><strong>Metronome Events:</strong> <code style={preStyle}>{JSON.stringify(metronomeEventsResult)}</code></p>
                </div>
            </details>
        </div>
    );
};

export default PlayerTester;