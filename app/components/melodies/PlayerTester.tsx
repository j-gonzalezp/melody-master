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

import { completeAndGetNextExercise, getFirstExercise, GroupProgressDocument, ExerciseState } from '@/lib/actions/groupProgressActions'; // Import types if needed
import { calculateAverage } from '@/lib/utils';

const degreeRegex = /^(b|#|bb|##)?([1-7])$/;

// Define types for API responses
interface EligibleExercise { groupID: string; melodyLength: number; bpm: number; }
interface FetchSuccessResponse { success: true; exerciseParams: EligibleExercise; }
interface CompleteSuccessResponseNext { success: true; nextExercise: EligibleExercise; allGraduatedAtLevel?: never; }
interface CompleteSuccessResponseGraduated { success: true; allGraduatedAtLevel: true; level: number; nextExercise?: never; }
interface ErrorResponse { success: false; error: string; }
type FetchResponse = FetchSuccessResponse | ErrorResponse;
type CompleteResponse = CompleteSuccessResponseNext | CompleteSuccessResponseGraduated | ErrorResponse;


const PlayerTester = () => {
    const sectionStyle: React.CSSProperties = { border: '1px solid #ccc', padding: '15px', marginBottom: '15px', borderRadius: '5px', opacity: 1, transition: 'opacity 0.3s ease-in-out' };
    const disabledSectionStyle: React.CSSProperties = { ...sectionStyle, opacity: 0.6, pointerEvents: 'none' };
    const inputStyle: React.CSSProperties = { marginRight: '5px', marginBottom: '5px', padding: '5px', width: '50px', textAlign: 'center', border: '1px solid #ccc', borderRadius: '3px', backgroundColor: 'white', color: 'black', transition: 'background-color 0.2s ease-in-out, border-color 0.2s ease-in-out' };
    const inputContainerStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', marginBottom: '15px' };
    const feedbackInputCorrectStyle: React.CSSProperties = { ...inputStyle, backgroundColor: 'lightgreen', borderColor: 'green' };
    const feedbackInputIncorrectStyle: React.CSSProperties = { ...inputStyle, backgroundColor: 'lightcoral', borderColor: 'darkred' };
    const feedbackInputInvalidFormatStyle: React.CSSProperties = { ...inputStyle, borderColor: 'orange' };
    const preStyle: React.CSSProperties = { background: '#eee', padding: '10px', borderRadius: '3px', maxHeight: '150px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' };
    const errorStyle: React.CSSProperties = { color: 'red', fontWeight: 'bold', marginTop: '10px' };
    const statusStyle: React.CSSProperties = { color: 'blue', fontWeight: 'bold', marginTop: '10px' };
    const loadingStyle: React.CSSProperties = { fontStyle: 'italic', color: 'grey' };
    const graduatedStyle: React.CSSProperties = { color: 'green', fontWeight: 'bold', marginTop: '10px', border: '1px solid green', padding: '10px', borderRadius: '5px' };

    type FeedbackStatus = 'correct' | 'incorrect' | 'empty' | 'invalid_format' | null;

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
    const [notesInputConfig, setNotesInputConfig] = useState<string>(""); // Represents groupID
    const [bpmInput, setBpmInput] = useState<string>("");
    const [keyId, setKeyId] = useState<string>('C'); // Assuming C Major for now

    const [noteSequenceResult, setNoteSequenceResult] = useState<string[] | null>(null);
    const [rhythmResult, setRhythmResult] = useState<RhythmEvent[] | null>(null);
    const [fullSequenceResult, setFullSequenceResult] = useState<SequenceEvent[] | null>(null);
    const [metronomeEventsResult, setMetronomeEventsResult] = useState<MetronomeEvent[] | null>(null);
    const [parsedDegreesResult, setParsedDegreesResult] = useState<string[] | null>(null);

    const [loopPlayback, setLoopPlayback] = useState<boolean>(false);
    const [toneState, setToneState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [error, setError] = useState<string | null>(null);
    const [lastPlayedNote, setLastPlayedNote] = useState<string | null>(null);
    const [loopStatus, setLoopStatus] = useState<string>('');
    const [isPlaying, setIsPlaying] = useState(false);

    const [isFetching, setIsFetching] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
    const [allGraduatedMessage, setAllGraduatedMessage] = useState<string | null>(null);

    const [amountOfQuestions, setAmountOfQuestions] = useState<number>(5);
    const [inputValues, setInputValues] = useState<string[]>([]);
    const [exerciseScore, setExerciseScore] = useState<number[]>([]); // Stores scores (0-100) for the current set
    const [questionCount, setQuestionCount] = useState<number>(1);
    const [inputValidationStatus, setInputValidationStatus] = useState<FeedbackStatus[]>([]);
    const [firstAttemptScoreStatus, setFirstAttemptScoreStatus] = useState<FeedbackStatus[]>([]);

    const pianoRef = useRef<Tone.Sampler | null>(null);
    const metronomeRef = useRef<MetronomeInstruments | null>(null);
    const playerControlsRef = useRef<SequencePlayerControls | null>(null);

    // --- Tone.js Initialization Effect ---
    useEffect(() => {
        let isMounted = true;
        const initTone = async () => {
             if (toneState !== 'idle') return;
             setToneState('loading'); setError(null); console.log("Initializing Tone.js...");
             try {
                 playerControlsRef.current?.stop();
                 pianoRef.current?.dispose(); metronomeRef.current?.metronome?.dispose(); metronomeRef.current?.metronomeAccent?.dispose();
                 pianoRef.current = null; metronomeRef.current = null; playerControlsRef.current = null;

                 const piano = createPiano(); const metronome = createMetronome();
                 await Tone.loaded();

                 if (isMounted) { pianoRef.current = piano; metronomeRef.current = metronome; setToneState('ready'); console.log("Tone.js ready."); }
                 else { piano.dispose(); metronome.metronome?.dispose(); metronome.metronomeAccent?.dispose(); console.log("Tone.js init aborted."); }
             } catch (err) {
                 console.error("Tone.js init error:", err);
                 if (isMounted) { setError(`Tone Error: ${err instanceof Error ? err.message : String(err)}`); setToneState('error'); }
             }
        };
        initTone();
        return () => {
             isMounted = false; console.log("Cleaning up Tone.js...");
             playerControlsRef.current?.stop(); pianoRef.current?.dispose(); metronomeRef.current?.metronome?.dispose(); metronomeRef.current?.metronomeAccent?.dispose();
             if (Tone.Transport.state === "started") { Tone.Transport.stop(); } Tone.Transport.cancel();
             pianoRef.current = null; metronomeRef.current = null; playerControlsRef.current = null; console.log("Tone.js cleaned up.");
        };
    }, []); // Run only once on mount

    // --- Fetch Initial Exercise Effect ---
    useEffect(() => {
        let isMounted = true;
        const fetchInitialExerciseData = async () => {
            setIsFetching(true); setError(null); setAllGraduatedMessage(null);
            // Reset relevant state
            setNoteSequenceResult(null); setRhythmResult(null); setFullSequenceResult(null); setMetronomeEventsResult(null); setParsedDegreesResult(null);
            setNNotesInput(""); setNotesInputConfig(""); setBpmInput(""); setKeyId('C');
            setInputValues([]); setInputValidationStatus([]); setFirstAttemptScoreStatus([]); setExerciseScore([]);
            setQuestionCount(1); setIsEvaluating(false);

            // Define user/context (replace with actual values)
            const userID = "testuser"; const context = "major"; const initialGroupID = "(1,3)"; const initialLevel = 2;

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
                    const numNotes = params.melodyLength ?? 0;
                    // Initialize input arrays based on melody length
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
        fetchInitialExerciseData();
        return () => { isMounted = false; };
    }, []); // Run only once on mount


    // --- Generation Logic Callbacks ---
    const generateRhythm = useCallback((): RhythmEvent[] | null => {
        setError(null);
        try {
            const nNotes = parseInt(nNotesInput, 10); const totalBeats = parseInt(totalBeatsInput, 10); const restProb = parseFloat(restProbabilityInput);
            if (isNaN(nNotes) || nNotes <= 0 || isNaN(totalBeats) || totalBeats <= 0 || isNaN(restProb) || restProb < 0 || restProb > 1) throw new Error("Invalid rhythm params.");
            const options: RhythmGeneratorOptions = { totalBeats, shortestDuration, longestDuration, n: nNotes, allowRests, restProbability: restProb };
            const result = rhythmGenerator(options); if (!result || result.length === 0) throw new Error("Rhythm generation failed."); return result;
        } catch (err) { console.error("Error generating rhythm:", err); setError(`Rhythm Error: ${err instanceof Error ? err.message : String(err)}`); return null; }
    }, [nNotesInput, totalBeatsInput, shortestDuration, longestDuration, allowRests, restProbabilityInput]);

    const generateNotes = useCallback((): { notes: string[] | null, degrees: string[] | null } => {
        setError(null);
        try {
            const nNotes = parseInt(nNotesInput, 10); const maxInt = parseInt(maxIntervalInput, 10); const minInt = parseInt(minIntervalInput, 10);
            if (isNaN(nNotes) || nNotes <= 0 || isNaN(maxInt) || isNaN(minInt) || !keyId || !rangeStart || !rangeEnd || !notesInputConfig) throw new Error("Invalid note gen params.");
            const parsedDegreesRaw = parseDegreeString(notesInputConfig); if (!Array.isArray(parsedDegreesRaw) || parsedDegreesRaw.some(d => typeof d !== 'string')) throw new Error(`Failed to parse degrees: '${notesInputConfig}'.`);
            const parsedDegreesStr = parsedDegreesRaw as string[]; if (parsedDegreesStr.length === 0) throw new Error(`Parsing degrees '${notesInputConfig}' resulted in empty.`);
            const sequenceOptions: GenerateNoteSequenceOptions = { keyId, notes: parsedDegreesStr, range: [rangeStart, rangeEnd], numberOfNotes: nNotes, maxInterval: maxInt, minInterval: minInt };
            const generatedNotes = generateNoteSequence(sequenceOptions); if (!generatedNotes || generatedNotes.length === 0) throw new Error("Note sequence generation failed."); return { notes: generatedNotes, degrees: parsedDegreesStr };
        } catch (err) { console.error("Error generating notes:", err); setError(`Notes Error: ${err instanceof Error ? err.message : String(err)}`); return { notes: null, degrees: null }; }
    }, [notesInputConfig, nNotesInput, keyId, rangeStart, rangeEnd, maxIntervalInput, minIntervalInput]);

    const combineSequenceAndMetronome = useCallback((notes: string[], rhythm: RhythmEvent[]): { fullSeq: SequenceEvent[] | null, metroEvents: MetronomeEvent[] | null } => {
        setError(null);
        try {
            const fullSeq = createFullSequence(notes, rhythm); if (!fullSeq || fullSeq.length === 0) throw new Error("Combining notes/rhythm failed.");
            let metroEvents: MetronomeEvent[] | null = null; const bpm = parseInt(bpmInput, 10);
            if (!isNaN(bpm) && bpm > 0) {
                try {
                    const totalSeconds = fullSeq.reduce((time, event) => time + Tone.Time(event.duration).toSeconds(), 0); const totalSequenceBeats = totalSeconds * (bpm / 60);
                    if (totalSequenceBeats > 0) metroEvents = createMetronomeEvents(Math.ceil(totalSequenceBeats));
                } catch (calcError) { console.error("Error calculating metronome events:", calcError); setError(prev => prev ? `${prev} | Metro Err` : `Metro Err`); }
            } return { fullSeq, metroEvents };
        } catch (err) { console.error("Error combining sequence:", err); setError(`Combine Error: ${err instanceof Error ? err.message : String(err)}`); return { fullSeq: null, metroEvents: null }; }
    }, [bpmInput]);

    // --- Generate Full Exercise Orchestration ---
    const generateFullExercise = useCallback(async (): Promise<boolean> => {
        if (isGenerating || isFetching) return false;
        setIsGenerating(true); setError(null); setAllGraduatedMessage(null);
        setNoteSequenceResult(null); setRhythmResult(null); setFullSequenceResult(null); setMetronomeEventsResult(null); setParsedDegreesResult(null);
        console.log("Generating new exercise sequence...");
        try {
            const generatedRhythm = generateRhythm(); if (!generatedRhythm) throw new Error("Rhythm generation failed.");
            const { notes: generatedNotes, degrees: parsedDegs } = generateNotes(); if (!generatedNotes || !parsedDegs) throw new Error("Note generation failed.");
            const { fullSeq: combinedSeq, metroEvents: createdMetroEvents } = combineSequenceAndMetronome(generatedNotes, generatedRhythm); if (!combinedSeq) throw new Error("Sequence combination failed.");

            // Set state only after all parts succeed
            setRhythmResult(generatedRhythm); setNoteSequenceResult(generatedNotes); setParsedDegreesResult(parsedDegs);
            setFullSequenceResult(combinedSeq); setMetronomeEventsResult(createdMetroEvents);
            console.log("Full exercise generation successful."); setIsGenerating(false); return true;
        } catch (err) {
            console.error("Error generating full exercise:", err); setError(`Generation failed: ${err instanceof Error ? err.message : String(err)}`);
            setIsGenerating(false); return false;
        }
    }, [isGenerating, isFetching, generateRhythm, generateNotes, combineSequenceAndMetronome]);

    // --- Auto-Generate Effect ---
    useEffect(() => {
        const nNotes = parseInt(nNotesInput, 10); const bpm = parseInt(bpmInput, 10);
        const paramsValid = nNotesInput && !isNaN(nNotes) && nNotes > 0 && notesInputConfig && bpmInput && !isNaN(bpm) && bpm > 0 && keyId && rangeStart && rangeEnd;
        if (paramsValid && !isFetching && !isGenerating && toneState === 'ready' && !noteSequenceResult && !allGraduatedMessage) {
            console.log("Params valid, generating exercise...");
            generateFullExercise();
        }
    }, [nNotesInput, notesInputConfig, bpmInput, keyId, rangeStart, rangeEnd, isFetching, isGenerating, toneState, noteSequenceResult, generateFullExercise, allGraduatedMessage]);

    // --- Playback Handlers ---
    const handlePlay = useCallback(async () => {
        setError(null); setLastPlayedNote(null); setLoopStatus('');
        if (isPlaying || isGenerating || toneState !== 'ready' || !pianoRef.current || !metronomeRef.current || allGraduatedMessage) return;
        const currentBpm = parseInt(bpmInput, 10); if (isNaN(currentBpm) || currentBpm <= 0) { setError(`Invalid BPM: ${bpmInput}`); return; }

        let finalFullSequence = fullSequenceResult; let finalNoteSequence = noteSequenceResult; let finalMetronomeEvents = metronomeEventsResult;
        // Regenerate if sequence is missing (should ideally not happen with auto-generate)
        if (!finalFullSequence || finalFullSequence.length === 0) {
            console.warn("Sequence missing, attempting regeneration before play...");
            const success = await generateFullExercise(); if (!success) { setError(prev => prev ? `${prev} | Cannot play.` : "Gen failed. Cannot play."); return; }
            finalFullSequence = fullSequenceResult; finalNoteSequence = noteSequenceResult; finalMetronomeEvents = metronomeEventsResult;
        }
        if (!finalFullSequence || !finalNoteSequence) { setError("Sequence missing. Cannot play."); return; }

        try {
            await Tone.start(); if (Tone.context.state !== 'running') throw new Error("AudioContext failed to start.");
            playerControlsRef.current?.stop(); if (Tone.Transport.state === 'started') Tone.Transport.stop(); Tone.Transport.cancel(); Tone.Transport.bpm.value = currentBpm;

            const playOptions: PlaySequenceOptions = {
                fullSequence: finalFullSequence, generatedNotes: finalNoteSequence, piano: pianoRef.current, metronomeInstruments: metronomeRef.current,
                metronomeEvents: finalMetronomeEvents ?? undefined, loop: loopPlayback, bpm: currentBpm,
                onNotePlay: (time, note, index) => { Tone.Draw.schedule(() => setLastPlayedNote(`Note: ${note} (idx: ${index})`), time); },
                onLoopStart: (time, count) => { Tone.Draw.schedule(() => setLoopStatus(`Loop ${count + 1} started`), time); },
                onLoopEnd: (time, count) => { Tone.Draw.schedule(() => setLoopStatus(`Loop ${count + 1} ended`), time); },
            };
            const controls = await playSequence(playOptions);
            controls.onStop = () => {
                // Check if this specific control instance is the one stopping
                if (playerControlsRef.current === controls) {
                     setIsPlaying(false); playerControlsRef.current = null;
                     Tone.Draw.schedule(() => { setLastPlayedNote('Playback stopped.'); setLoopStatus(prev => prev ? `${prev} | Stopped.` : 'Stopped.'); }, Tone.now());
                } else if (isPlaying) { setIsPlaying(false); /* Avoid nulling if another play started */ }
            };
            playerControlsRef.current = controls; controls.play(); setIsPlaying(true); setLastPlayedNote('Playback starting...');
        } catch (err) { console.error("Error during handlePlay:", err); setError(`Play Error: ${err instanceof Error ? err.message : String(err)}`); setIsPlaying(false); playerControlsRef.current?.stop(); playerControlsRef.current = null; if (Tone.Transport.state === "started") { Tone.Transport.stop(); Tone.Transport.cancel(); } }
    }, [toneState, isPlaying, isGenerating, bpmInput, fullSequenceResult, noteSequenceResult, metronomeEventsResult, loopPlayback, generateFullExercise, pianoRef, metronomeRef, setIsPlaying, setError, setLastPlayedNote, setLoopStatus, allGraduatedMessage]);

    const handleStop = useCallback(() => {
        if (playerControlsRef.current) { playerControlsRef.current.stop(); /* onStop callback handles state */ }
        else if (Tone.Transport.state === 'started') { Tone.Transport.stop(); Tone.Transport.cancel(); setIsPlaying(false); setLastPlayedNote('Forced Stop'); setLoopStatus(prev => prev ? `${prev} | Forced Stop` : 'Forced Stop'); }
        else if (isPlaying) { setIsPlaying(false); }
    }, [isPlaying]);

    // --- Input Handling and Validation ---
    useEffect(() => { // Adjust input array size when nNotesInput changes
        const numNotes = parseInt(nNotesInput, 10);
        if (!isNaN(numNotes) && numNotes > 0) {
            if (inputValues.length !== numNotes) { setInputValues(Array(numNotes).fill('')); setInputValidationStatus(Array(numNotes).fill(null)); setFirstAttemptScoreStatus(Array(numNotes).fill(null)); }
        } else if (inputValues.length > 0) { setInputValues([]); setInputValidationStatus([]); setFirstAttemptScoreStatus([]); }
    }, [nNotesInput]);

    const handleInputChange = useCallback((index: number, event: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = event.target.value; const trimmedValue = newValue.trim();
        setInputValues(prev => { const next = [...prev]; next[index] = newValue; return next; });
        if (trimmedValue === '') { setInputValidationStatus(prev => { const next = [...prev]; next[index] = null; return next; }); return; }

        const isValidFormat = degreeRegex.test(trimmedValue); let currentCorrectness: FeedbackStatus = 'invalid_format';
        if (isValidFormat && noteSequenceResult && keyId) {
            try {
                const expectedNote = noteSequenceResult[index]; const expectedDegree = getDegreeFromNote(expectedNote, keyId);
                const normalizedInput = trimmedValue.toLowerCase(); const normalizedExpected = expectedDegree.toLowerCase();
                currentCorrectness = (normalizedInput === normalizedExpected) ? 'correct' : 'incorrect';
            } catch (err) { console.error(`Error validating input ${index}:`, err); currentCorrectness = 'incorrect'; setError(prev => prev ? `${prev} | Err valid ${index + 1}` : `Err valid ${index + 1}`); }
        } else if (!noteSequenceResult || !keyId) { currentCorrectness = isValidFormat ? null : 'invalid_format'; }

        setInputValidationStatus(prev => { const next = [...prev]; next[index] = currentCorrectness; return next; });

        // Record first attempt score
        if (currentCorrectness === 'correct' || currentCorrectness === 'incorrect') {
            setFirstAttemptScoreStatus(prevScore => {
                const nextScore = [...prevScore]; if (nextScore[index] === null) nextScore[index] = currentCorrectness; return nextScore;
            });
        }
    }, [noteSequenceResult, keyId, setError]);

    // --- Progress to Next Question / Exercise ---
    const handleNext = useCallback(async () => {
        if (isEvaluating || allGraduatedMessage) return;
        handleStop(); setIsEvaluating(true); setError(null);

        // 1. Calculate score for the question just finished
        let correctFirstAttempts = 0; const numExpectedNotes = noteSequenceResult?.length ?? 0;
        if (numExpectedNotes > 0) { correctFirstAttempts = firstAttemptScoreStatus.filter(status => status === 'correct').length; }
        const currentQuestionScore = numExpectedNotes > 0 ? (correctFirstAttempts / numExpectedNotes) * 100 : 0; // Score 0-100
        const updatedScores = [...exerciseScore, currentQuestionScore]; setExerciseScore(updatedScores);
        console.log(`--- Question ${questionCount} Finished | Score: ${currentQuestionScore.toFixed(1)}% (${correctFirstAttempts}/${numExpectedNotes}) ---`);

        // 2. Decide: Next question or finish set?
        if (questionCount < amountOfQuestions) {
             // --- Move to next question within the set ---
            setQuestionCount(prev => prev + 1);
            const numNotes = parseInt(nNotesInput, 10); const resetSize = !isNaN(numNotes) && numNotes > 0 ? numNotes : 0;
            setInputValues(Array(resetSize).fill('')); setInputValidationStatus(Array(resetSize).fill(null)); setFirstAttemptScoreStatus(Array(resetSize).fill(null));
            setLastPlayedNote(null); setLoopStatus('');

            const success = await generateFullExercise(); // Generate new melody for the same parameters
            if (!success) setError(prev => prev ? `${prev} | Gen Error Q${questionCount + 1}` : `Gen Error Q${questionCount + 1}`);
            else { // Handle potential melody length mismatch if generation logic changes (unlikely here)
                 const newNumNotes = noteSequenceResult?.length ?? 0;
                 if (newNumNotes !== resetSize) { setInputValues(Array(newNumNotes).fill('')); setInputValidationStatus(Array(newNumNotes).fill(null)); setFirstAttemptScoreStatus(Array(newNumNotes).fill(null)); }
            }
            setIsEvaluating(false);
        } else {
            // --- Finish the set and get the next exercise ---
            console.log(`Final question finished. Submitting results.`);
            try {
                const finalAverageScore100 = calculateAverage(updatedScores); // Average score 0-100
                const finalAccuracy01 = finalAverageScore100 / 100; // Convert to 0-1 for the action
                console.log(`Final Average Accuracy: ${finalAccuracy01.toFixed(3)} (${finalAverageScore100.toFixed(1)}%)`);

                const userID = "testuser"; const context = "major";
                const completedGroupId = notesInputConfig; const completedMelodyLength = parseInt(nNotesInput, 10);
                if (isNaN(completedMelodyLength) || !completedGroupId) throw new Error("Invalid params for submission.");

                const result = await completeAndGetNextExercise(userID, context, completedGroupId, completedMelodyLength, finalAccuracy01) as CompleteResponse;

                if (result.success) {
                    if (result.nextExercise) {
                        // --- Load next exercise ---
                        const nextParams = result.nextExercise;
                        console.log("Received next exercise parameters:", nextParams);
                        setNNotesInput(String(nextParams.melodyLength ?? ''));
                        setNotesInputConfig(nextParams.groupID ?? '');
                        setBpmInput(String(nextParams.bpm ?? ''));
                        setKeyId('C'); // Reset key or get from context/params if needed
                        setQuestionCount(1); setExerciseScore([]); // Reset for the new set
                        const numNotes = nextParams.melodyLength ?? 0;
                        setInputValues(Array(numNotes).fill('')); setInputValidationStatus(Array(numNotes).fill(null)); setFirstAttemptScoreStatus(Array(numNotes).fill(null));
                        setNoteSequenceResult(null); setRhythmResult(null); setFullSequenceResult(null); setMetronomeEventsResult(null); setParsedDegreesResult(null); // Trigger regeneration
                        setLastPlayedNote("New exercise loaded.");
                        setAllGraduatedMessage(null); // Clear graduated message if any
                    } else if (result.allGraduatedAtLevel) {
                        // --- Handle level completion ---
                        console.log(`All exercises graduated at level ${result.level}.`);
                        setAllGraduatedMessage(`Congratulations! You've mastered all exercises at level ${result.level}.`);
                        // Optionally disable further actions or redirect
                    }
                } else {
                    console.error("API Error getting next exercise:", result.error);
                    setError(`API Error: ${result.error || "Failed to get next exercise."}`);
                }
            } catch (err) {
                console.error("Error during final submission:", err);
                setError(`Submission Error: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
                setIsEvaluating(false);
            }
        }
    }, [
        isEvaluating, questionCount, amountOfQuestions, exerciseScore, notesInputConfig, nNotesInput, keyId, noteSequenceResult, firstAttemptScoreStatus, allGraduatedMessage,
        handleStop, generateFullExercise, calculateAverage, completeAndGetNextExercise,
        setQuestionCount, setExerciseScore, setInputValues, setInputValidationStatus, setFirstAttemptScoreStatus, setError, setLastPlayedNote, setLoopStatus, setIsEvaluating,
        setNNotesInput, setNotesInputConfig, setBpmInput, setKeyId, setNoteSequenceResult, setRhythmResult, setFullSequenceResult, setMetronomeEventsResult, setParsedDegreesResult, setAllGraduatedMessage
    ]);


    // --- Memoized UI Elements ---
    const dynamicInputs = useMemo(() => {
        const numNotes = parseInt(nNotesInput, 10);
        if (isNaN(numNotes) || numNotes <= 0) { return <p style={loadingStyle}>Waiting for parameters...</p>; }
        if (!noteSequenceResult) { return <p style={loadingStyle}>Generating melody...</p>; }
        if (numNotes !== noteSequenceResult.length) { return <p style={errorStyle}>Note count mismatch ({noteSequenceResult.length} generated vs {numNotes} expected). Please wait or refresh.</p>; }

        return Array.from({ length: numNotes }).map((_, index) => {
            let currentStyle = inputStyle; const validationStatus = inputValidationStatus[index];
            switch (validationStatus) { case 'correct': currentStyle = feedbackInputCorrectStyle; break; case 'incorrect': currentStyle = feedbackInputIncorrectStyle; break; case 'invalid_format': currentStyle = feedbackInputInvalidFormatStyle; break; }
            const isInputDisabled = isEvaluating || !noteSequenceResult || !!allGraduatedMessage; // Disable if level graduated
            return (<input key={`input-${index}`} type="text" value={inputValues[index] ?? ''} onChange={(event) => handleInputChange(index, event)} placeholder={`${index + 1}`} style={currentStyle} disabled={isInputDisabled} aria-label={`Scale degree input ${index + 1}`}/>);
        });
    }, [nNotesInput, inputValues, inputValidationStatus, handleInputChange, isEvaluating, noteSequenceResult, allGraduatedMessage]);

    const parsedGroupIdDegrees = useMemo(() => {
        if (!notesInputConfig) return []; try { const degrees = parseDegreeString(notesInputConfig); return Array.isArray(degrees) ? degrees.map(String) : []; } catch (e) { return []; }
    }, [notesInputConfig]);

    const isReady = toneState === 'ready';
    const isLoading = toneState === 'loading' || isFetching || isGenerating;
    const canProceedToNext = !isEvaluating && !!noteSequenceResult && firstAttemptScoreStatus.length === noteSequenceResult.length && firstAttemptScoreStatus.every(status => status !== null) && !allGraduatedMessage;
    const isInteractionDisabled = !isReady || isLoading || !!allGraduatedMessage;


    // --- Render ---
    return (
        <div>
            <h1>Scale Degree Ear Trainer</h1>
            <div>Tone State: {toneState} {isLoading && <span style={loadingStyle}>(Loading...)</span>}</div>
            {isEvaluating && <div style={loadingStyle}>{questionCount < amountOfQuestions ? 'Calculating score...' : 'Submitting results...'}</div>}
            {error && <div style={errorStyle}>Error: {error}</div>}
            {lastPlayedNote && <div style={statusStyle}>Status: {lastPlayedNote}</div>}
            {loopStatus && <div style={statusStyle}>Loop: {loopStatus}</div>}
            {allGraduatedMessage && <div style={graduatedStyle}>{allGraduatedMessage}</div>}

            <div style={isInteractionDisabled ? disabledSectionStyle : sectionStyle}>
                <h2>Exercise: Question {questionCount} of {amountOfQuestions}</h2>
                <p>Listen, then enter scale degrees (e.g., 1, b3, #5).</p>
                <div style={{ marginBottom: '10px', fontSize: '0.9em', color: '#555' }}>
                    Target: {nNotesInput || '?'} notes | Group: {notesInputConfig || '?'} ({parsedGroupIdDegrees.join(', ')}) | BPM: {bpmInput || '?'} | Key: {keyId || '?'}
                </div>

                <button onClick={isPlaying ? handleStop : handlePlay} disabled={isEvaluating || !isReady || (!isPlaying && (isLoading || !noteSequenceResult)) || !!allGraduatedMessage} style={{ minWidth: '120px'}} >
                    {isPlaying ? "Stop" : "Play Melody"}
                </button>
                <label style={{ marginLeft: '15px' }}>
                    <input type="checkbox" checked={loopPlayback} onChange={(e) => setLoopPlayback(e.target.checked)} disabled={isPlaying || isEvaluating || !isReady || !!allGraduatedMessage} /> Loop
                </label>

                <div style={isInteractionDisabled ? disabledSectionStyle : sectionStyle}>
                    <h3>Your Answer:</h3>
                    <div style={inputContainerStyle}> {dynamicInputs} </div>
                    {inputValidationStatus.includes('invalid_format') && <p style={{color: 'orange', fontSize: '0.8em'}}>Use format like '1', 'b3', '#5'.</p>}
                </div>

                <button onClick={handleNext} disabled={!canProceedToNext || isEvaluating || !!allGraduatedMessage} style={{ marginTop: '15px', fontWeight: 'bold' }}>
                    {isEvaluating ? "Processing..." : (questionCount < amountOfQuestions ? `Next Question (${questionCount + 1}/${amountOfQuestions})` : "Finish & Get Next Exercise")}
                </button>

                 {exerciseScore.length > 0 && (
                    <div style={{ marginTop: '10px', borderTop: '1px dashed #ccc', paddingTop: '10px' }}>
                         Scores: {exerciseScore.map((s, i) => <span key={i} style={{fontWeight: i === exerciseScore.length -1 ? 'bold':'normal'}}>{`Q${i+1}: ${s.toFixed(0)}% `}</span>)}
                         {exerciseScore.length === amountOfQuestions && <span>| Avg: {(calculateAverage(exerciseScore)).toFixed(1)}%</span>}
                    </div>
                 )}
            </div>

            <details>
                <summary>Debug Info</summary>
                <div style={sectionStyle}>
                    <p>Target Notes (Debug): <code style={preStyle}>{JSON.stringify(noteSequenceResult)}</code></p>
                    <p>Input Visual Status: <code style={preStyle}>{JSON.stringify(inputValidationStatus)}</code></p>
                    <p>First Attempt Recorded: <code style={preStyle}>{JSON.stringify(firstAttemptScoreStatus)}</code></p>
                    <p>Rhythm: <code style={preStyle}>{JSON.stringify(rhythmResult?.map(r => r.duration))}</code></p>
                    {/* Add more debug info as needed */}
                </div>
            </details>
        </div>
    );
};

export default PlayerTester;