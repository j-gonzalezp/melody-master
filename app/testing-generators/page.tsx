"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as Tone from 'tone';
import {
    DurationString,
    RhythmEvent,
    SequenceEvent,
    MetronomeEvent,
    MetronomeInstruments,
    SequencePlayerControls,
    durationValues,
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
    PlaySequenceOptions
} from '../../lib/musicUtils';
import { getFirstExercise } from '@/lib/actions/groupProgressActions';

const sectionStyle: React.CSSProperties = { border: '1px solid #ccc', padding: '15px', marginBottom: '15px', borderRadius: '5px', opacity: 1, transition: 'opacity 0.3s ease-in-out' };
const disabledSectionStyle: React.CSSProperties = { ...sectionStyle, opacity: 0.6, pointerEvents: 'none' };
const inputStyle: React.CSSProperties = { marginRight: '10px', marginBottom: '5px', padding: '5px' };
const preStyle: React.CSSProperties = { background: '#eee', padding: '10px', borderRadius: '3px', maxHeight: '200px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' };
const errorStyle: React.CSSProperties = { color: 'red', fontWeight: 'bold', marginTop: '10px'};
const statusStyle: React.CSSProperties = { color: 'blue', fontWeight: 'bold', marginTop: '10px'};
const loadingStyle: React.CSSProperties = { fontStyle: 'italic', color: 'grey' };

interface ExerciseParams {
    groupID: string;
    melodyLength: number;
    bpm: number;
}
interface SuccessResponse {
    success: true;
    exerciseParams: ExerciseParams;
}
interface ErrorResponse {
    success: false;
    error: string;
}
type FetchResponse = SuccessResponse | ErrorResponse;


const Page = () => {
    const [totalBeatsInput, setTotalBeatsInput] = useState<string>("4");
    const [shortestDuration, setShortestDuration] = useState<DurationString>('16n');
    const [longestDuration, setLongestDuration] = useState<DurationString>('4n');
    const [allowRests, setAllowRests] = useState<boolean>(true);
    const [restProbabilityInput, setRestProbabilityInput] = useState<string>("0.2");
    const [rangeStart, setRangeStart] = useState<string>('C3');
    const [rangeEnd, setRangeEnd] = useState<string>('C5');
    const [keyId, setKeyId] = useState<string>('C');
    const [maxIntervalInput, setMaxIntervalInput] = useState<string>("12");
    const [minIntervalInput, setMinIntervalInput] = useState<string>("1");
    const [nNotesInput, setNNotesInput] = useState<string>("");
    const [notesInputConfig, setNotesInputConfig] = useState<string>("");
    const [bpmInput, setBpmInput] = useState<string>("");

    const [noteSequenceResult, setNoteSequenceResult] = useState<string[] | null>(null);
    const [rhythmResult, setRhythmResult] = useState<RhythmEvent[] | null>(null);
    const [fullSequenceResult, setFullSequenceResult] = useState<SequenceEvent[] | null>(null);
    const [metronomeEventsResult, setMetronomeEventsResult] = useState<MetronomeEvent[] | null>(null);
    const [parsedDegreesResult, setParsedDegreesResult] = useState<number[] | null>(null);

    const [loopPlayback, setLoopPlayback] = useState<boolean>(false);
    const [toneState, setToneState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [error, setError] = useState<string | null>(null);
    const [lastPlayedNote, setLastPlayedNote] = useState<string | null>(null);
    const [loopStatus, setLoopStatus] = useState<string>('');
    const [isPlaying, setIsPlaying] = useState(false);
    const [isFetching, setIsFetching] = useState(false);

    const pianoRef = useRef<Tone.Sampler | null>(null);
    const metronomeRef = useRef<MetronomeInstruments | null>(null);
    const playerControlsRef = useRef<SequencePlayerControls | null>(null);

    useEffect(() => {
        let isMounted = true;
        const initTone = async () => {
            if (toneState !== 'idle') return;
            setToneState('loading');
            setError(null);
            console.log("Initializing Tone.js instruments...");
            try {
                pianoRef.current?.dispose();
                metronomeRef.current?.metronome?.dispose();
                metronomeRef.current?.metronomeAccent?.dispose();

                const piano = createPiano();
                const metronome = createMetronome();

                await Tone.loaded();

                if (isMounted) {
                    pianoRef.current = piano;
                    metronomeRef.current = metronome;
                    setToneState('ready');
                    console.log("Tone.js instruments initialized and ready.");
                } else {
                     piano.dispose();
                     metronome.metronome?.dispose();
                     metronome.metronomeAccent?.dispose();
                     console.log("Tone.js init aborted, component unmounted.");
                }
            } catch (err) {
                console.error("Error initializing Tone.js instruments:", err);
                 if (isMounted) {
                    setError(`Error initializing Tone.js: ${err instanceof Error ? err.message : String(err)}`);
                    setToneState('error');
                 }
            }
        };
        initTone();

        return () => {
            isMounted = false;
            console.log("Cleaning up Tone.js resources...");
            playerControlsRef.current?.stop();
            pianoRef.current?.dispose();
            metronomeRef.current?.metronome?.dispose();
            metronomeRef.current?.metronomeAccent?.dispose();
            if (Tone.Transport.state === "started") {
                Tone.Transport.stop();
            }
            Tone.Transport.cancel();
            pianoRef.current = null;
            metronomeRef.current = null;
            console.log("Tone.js resources cleaned up.");
        };
    }, []);

    useEffect(() => {
        let isMounted = true;
        const fetchInitialExerciseData = async () => {
            setIsFetching(true);
            setError(null);
            setNoteSequenceResult(null);
            setRhythmResult(null);
            setFullSequenceResult(null);
            setMetronomeEventsResult(null);
            setParsedDegreesResult(null);
            setNNotesInput("");
            setNotesInputConfig("");
            setBpmInput("");

            const userID = "testuser";
            const context = "major";
            const initialGroupID = "(1,3)";
            const initialLevel = 2;
            try {
                console.log("Fetching first exercise data...");
                const response = await getFirstExercise(userID, context, initialGroupID, initialLevel) as FetchResponse;
                console.log("Fetch response:", response);

                if (!isMounted) return;

                if (response.success) {
                    const params = response.exerciseParams;
                    setNNotesInput(String(params.melodyLength ?? ''));
                    setNotesInputConfig(params.groupID ?? '');
                    setBpmInput(String(params.bpm ?? ''));
                    console.log("Fetched data populated to input states:", { nNotesInput: String(params.melodyLength), notesInputConfig: params.groupID, bpmInput: String(params.bpm) });
                } else {
                    const errorMsg = response.error || "Failed to fetch exercise parameters.";
                    setError(errorMsg);
                    console.warn("Fetch issue:", errorMsg, response);
                }

            } catch (err) {
                console.error("Error executing fetchInitialExerciseData:", err);
                if (isMounted) {
                    setError(err instanceof Error ? err.message : "An unknown error occurred during fetch.");
                }
            } finally {
                if (isMounted) {
                    setIsFetching(false);
                }
            }
        };
        fetchInitialExerciseData();
        return () => { isMounted = false; };
    }, []);

    const handleGenerateRhythm = useCallback(() => {
        setError(null);
        setRhythmResult(null);
        setFullSequenceResult(null);
        setMetronomeEventsResult(null);

        try {
            const nNotes = parseInt(nNotesInput, 10);
            const totalBeats = parseInt(totalBeatsInput, 10);
            const restProb = parseFloat(restProbabilityInput);

            if (isNaN(nNotes) || nNotes <= 0) throw new Error("Invalid 'Number of Notes' for rhythm generation.");
            if (isNaN(totalBeats) || totalBeats <= 0) throw new Error("Invalid 'Total Beats'.");
            if (isNaN(restProb) || restProb < 0 || restProb > 1) throw new Error("Invalid 'Rest Probability' (must be between 0 and 1).");

            const options: RhythmGeneratorOptions = {
                totalBeats,
                shortestDuration,
                longestDuration,
                n: nNotes,
                allowRests,
                restProbability: restProb,
            };
            console.log("Generating Rhythm with options:", options);
            const result = rhythmGenerator(options);
             if (!result || result.length === 0) {
                 throw new Error("Rhythm generation resulted in an empty pattern.");
             }
            setRhythmResult(result);
            console.log("Generated Rhythm:", result);
        } catch (err) {
            console.error("Error in handleGenerateRhythm:", err);
            setError(`Error generating rhythm: ${err instanceof Error ? err.message : String(err)}`);
            setRhythmResult(null);
        }
    }, [nNotesInput, totalBeatsInput, shortestDuration, longestDuration, allowRests, restProbabilityInput]);

    const handleGenerateSequence = useCallback(() => {
        setError(null);
        setNoteSequenceResult(null);
        setFullSequenceResult(null);
        setMetronomeEventsResult(null);
        setParsedDegreesResult(null);

        try {
            const nNotes = parseInt(nNotesInput, 10);
            const maxInt = parseInt(maxIntervalInput, 10);
            const minInt = parseInt(minIntervalInput, 10);

            if (isNaN(nNotes) || nNotes <= 0) throw new Error("Invalid 'Number of Notes'.");
            if (isNaN(maxInt)) throw new Error("Invalid 'Max Interval'.");
            if (isNaN(minInt)) throw new Error("Invalid 'Min Interval'.");
            if (!keyId) throw new Error("Key ID cannot be empty.");
            if (!rangeStart || !rangeEnd) throw new Error("Range Start and End cannot be empty.");
            if (!notesInputConfig) throw new Error("Allowed Degrees/Notes input cannot be empty.");

            const parsedDegreesRaw = parseDegreeString(notesInputConfig);

            if (!Array.isArray(parsedDegreesRaw)) {
                throw new Error(`Failed to parse degrees/notes string: '${notesInputConfig}'. Please use comma-separated numbers or format like (1,b3,5).`);
            }

            const parsedDegrees = parsedDegreesRaw.map(Number).filter(n => !isNaN(n));

            if (!Array.isArray(parsedDegrees) || parsedDegrees.length === 0) {
                throw new Error(`Parsing degrees/notes string '${notesInputConfig}' resulted in empty or invalid numeric degrees.`);
           }
           setParsedDegreesResult(parsedDegrees);

           const notesAsStringForOptions = parsedDegrees.map(String);

           const sequenceOptions: GenerateNoteSequenceOptions = {
               keyId,
               notes: notesAsStringForOptions,
               range: [rangeStart, rangeEnd],
               numberOfNotes: nNotes,
               maxInterval: maxInt,
               minInterval: minInt,
           };
           console.log("Generating Note Sequence with options:", sequenceOptions);
           const generatedNotes = generateNoteSequence(sequenceOptions);
            if (!generatedNotes || generatedNotes.length === 0) {
                 throw new Error("Note sequence generation resulted in an empty sequence.");
            }
            setNoteSequenceResult(generatedNotes);
            console.log("Generated Note Sequence:", generatedNotes);

        } catch (err) {
            console.error("Error during sequence generation:", err);
            setError(`Note Generation Error: ${err instanceof Error ? err.message : String(err)}`);
            setNoteSequenceResult(null);
            setParsedDegreesResult(null);
        }
    }, [notesInputConfig, nNotesInput, keyId, rangeStart, rangeEnd, maxIntervalInput, minIntervalInput]);

    const handleCreateFullSequence = useCallback(() => {
        setError(null);
        setFullSequenceResult(null);
        setMetronomeEventsResult(null);

        if (!noteSequenceResult || noteSequenceResult.length === 0) {
            setError("Cannot create full sequence: Please generate a Note Sequence first.");
            return;
        }
        if (!rhythmResult || rhythmResult.length === 0) {
            setError("Cannot create full sequence: Please generate a Rhythm Pattern first.");
            return;
        }

        try {
            console.log("Creating Full Sequence from:", { noteSequenceResult, rhythmResult });
            const fullSeq = createFullSequence(noteSequenceResult, rhythmResult);
             if (!fullSeq || fullSeq.length === 0) {
                 throw new Error("Combining notes and rhythm resulted in an empty full sequence.");
             }
            setFullSequenceResult(fullSeq);
            console.log("Generated Full Sequence:", fullSeq);

             const bpm = parseInt(bpmInput, 10);
             if (isNaN(bpm) || bpm <= 0) {
                 console.warn("Cannot generate metronome events: Invalid BPM value.", bpmInput);
                 setMetronomeEventsResult(null);
                 setError("Warning: Invalid BPM, metronome events not generated.");
             } else {
                 try {
                     const totalSeconds = fullSeq.reduce((time, event) => {
                         try {
                             return time + Tone.Time(event.duration).toSeconds();
                         } catch {
                             console.warn(`Invalid duration format in full sequence: ${event.duration}. Skipping for duration calculation.`);
                             return time;
                         }
                     }, 0);

                     const totalSequenceBeats = totalSeconds * (bpm / 60);
                     console.log(`Full sequence duration: ${totalSeconds.toFixed(2)}s, Estimated total beats: ${totalSequenceBeats.toFixed(2)} for metronome.`);

                     if (totalSequenceBeats > 0) {
                         const totalBeatsForMetronome = Math.ceil(totalSequenceBeats);
                         const metroEvents = createMetronomeEvents(totalBeatsForMetronome);
                         setMetronomeEventsResult(metroEvents);
                         console.log(`Generated ${metroEvents.length} Metronome Events for ${totalBeatsForMetronome} beats.`);
                     } else {
                         setMetronomeEventsResult(null);
                         console.warn("Generated full sequence has zero calculated duration. No metronome events generated.");
                     }
                 } catch (calcError) {
                      console.error("Error calculating duration or generating metronome events:", calcError);
                      setError(`Error generating metronome events: ${calcError instanceof Error ? calcError.message : String(calcError)}`);
                      setMetronomeEventsResult(null);
                 }
            }

        } catch (err) {
            console.error("Error creating full sequence:", err);
            setError(`Combination Error: ${err instanceof Error ? err.message : String(err)}`);
            setFullSequenceResult(null);
            setMetronomeEventsResult(null);
        }
    }, [noteSequenceResult, rhythmResult, bpmInput]);


    const handlePlay = useCallback(async () => {
        setError(null);
        setLastPlayedNote(null);
        setLoopStatus('');
        console.log("handlePlay triggered.");

        const currentBpm = parseInt(bpmInput, 10);

        if (toneState !== 'ready') { setError("Audio engine not ready."); return; }
        if (!pianoRef.current || !metronomeRef.current) { setError("Instruments not loaded."); return; }
        if (!fullSequenceResult || fullSequenceResult.length === 0) { setError("No valid sequence generated to play."); return; }
        if (!noteSequenceResult || noteSequenceResult.length === 0) { setError("Internal Error: Missing note sequence data for playback."); return; }
        if (isNaN(currentBpm) || currentBpm <= 0) { setError(`Invalid BPM value: ${bpmInput}`); return; }
        if (isPlaying) { console.warn("Play ignored: Already playing."); return; }

        try {
            console.log("Play: Ensuring AudioContext is running...");
            await Tone.start();
            console.log("AudioContext state after Tone.start():", Tone.context.state);
            if (Tone.context.state !== 'running') {
                throw new Error("AudioContext failed to start or resume. Please interact with the page (click) and try again.");
            }

            console.log("Play: Stopping previous playback if any...");
            playerControlsRef.current?.stop();

            if (Tone.Transport.state === 'started') { Tone.Transport.stop(); }
            Tone.Transport.cancel();

            console.log(`Play: Setting Transport BPM to ${currentBpm}`);
            Tone.Transport.bpm.value = currentBpm;

            console.log("Play: Calling playSequence with:", { fullSequenceResult, noteSequenceResult });

            const playOptions: PlaySequenceOptions = {
                fullSequence: fullSequenceResult,
                generatedNotes: noteSequenceResult,
                piano: pianoRef.current,
                metronomeInstruments: metronomeRef.current,
                metronomeEvents: metronomeEventsResult ?? undefined,
                loop: loopPlayback,
                bpm: currentBpm,
                onNotePlay: (time, note, index) => {
                    Tone.Draw.schedule(() => {
                        setLastPlayedNote(`Note: ${note} (idx: ${index}) @ ${time.toFixed(2)}`);
                    }, time);
                },
                onLoopStart: (time, count) => {
                    Tone.Draw.schedule(() => {
                        setLoopStatus(`Loop ${count + 1} started @ ${time.toFixed(2)}`);
                    }, time);
                },
                onLoopEnd: (time, count) => {
                     Tone.Draw.schedule(() => {
                        setLoopStatus(prev => `${prev || `Loop ${count + 1}`} ended @ ${time.toFixed(2)}`);
                     }, time);
                },
            };


            const controls = await playSequence(playOptions);

             controls.onStop = () => {
                 console.log("onStop callback executed for current controls.");
                 if (playerControlsRef.current === controls) {
                     setIsPlaying(false);
                     playerControlsRef.current = null;
                     Tone.Draw.schedule(() => {
                         setLastPlayedNote('Playback stopped.');
                         setLoopStatus(prev => prev ? `${prev} | Stopped.` : 'Stopped.');
                     }, Tone.now());
                 } else {
                     console.warn("onStop called, but the controls didn't match the active playerControlsRef.");
                     if (isPlaying) setIsPlaying(false);
                 }
             };

            console.log("Play: Storing controls and starting playback...");
            playerControlsRef.current = controls;
            controls.play();

            setIsPlaying(true);
            setLastPlayedNote('Playback starting...');
            console.log("Playback initiated via controls.play(). Transport state:", Tone.Transport.state);

        } catch (err) {
            console.error("Error during handlePlay:", err);
            setError(`Error playing sequence: ${err instanceof Error ? err.message : String(err)}`);
            setIsPlaying(false);
             playerControlsRef.current?.stop();
             playerControlsRef.current = null;
            if (Tone.Transport.state === "started") { Tone.Transport.stop(); }
            Tone.Transport.cancel();
        }
    }, [
        toneState, isPlaying, bpmInput,
        fullSequenceResult, noteSequenceResult, metronomeEventsResult,
        loopPlayback,
    ]);

    const handleStop = useCallback(() => {
        console.log("handleStop triggered.");
        if (isPlaying && playerControlsRef.current) {
            console.log("Stopping playback via playerControlsRef.current.stop()...");
            playerControlsRef.current.stop();
        } else if (Tone.Transport.state === 'started') {
            console.warn("Player controls ref missing or isPlaying is false, but Transport is running. Stopping Transport directly.");
            Tone.Transport.stop();
            Tone.Transport.cancel();
            setIsPlaying(false);
            setLastPlayedNote('Playback force stopped (no controls ref/state mismatch).');
            setLoopStatus(prev => prev ? `${prev} | Force Stopped.` : 'Force Stopped.');
            playerControlsRef.current = null;
        } else {
            console.log("Nothing to stop (not playing or transport already stopped).");
            if (isPlaying) {
                 console.warn("isPlaying was true but nothing seemed to be running. Resetting state.");
                 setIsPlaying(false);
                 playerControlsRef.current = null;
            }
        }
    }, [isPlaying]);

    const isReady = toneState === 'ready';
    const isLoading = toneState === 'loading';
    const canGenerateSequence = isReady && !isLoading && !isFetching;
    const canCombine = isReady && noteSequenceResult && rhythmResult;
    const canPlay = isReady && fullSequenceResult && !isPlaying && !isNaN(parseInt(bpmInput, 10)) && parseInt(bpmInput, 10) > 0;

    return (
        <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '800px', margin: 'auto' }}>
            <h1>Exercise Generator & Player (Refactored)</h1>

            {isLoading && <p style={statusStyle}>Loading Tone.js instruments... Please wait.</p>}
            {isFetching && <p style={statusStyle}>Fetching initial exercise data...</p>}
            {toneState === 'error' && <p style={errorStyle}>Tone.js Initialization Error: {error || '(Unknown Tone Error)'}</p>}
            {isReady && !isFetching && <p style={statusStyle}>System Ready.</p>}
            {error && toneState !== 'error' && <p style={errorStyle}>Runtime Error: {error}</p>}

            <div style={isReady ? {} : disabledSectionStyle}>

                <section style={sectionStyle}>
                    <h2>Initial/Current Parameters</h2>
                    <p style={{fontSize: '0.9em', color: '#555'}}> (Parameters fetched initially, feel free to modify before generating)</p>
                    <div>
                        <label>BPM: <input type="number" value={bpmInput} onChange={e => setBpmInput(e.target.value)} style={inputStyle} disabled={isFetching || !isReady} /></label>
                        <label>Number of Notes: <input type="number" value={nNotesInput} onChange={e => setNNotesInput(e.target.value)} style={inputStyle} disabled={isFetching || !isReady} /></label>
                    </div>
                    <div>
                        <label>Allowed Degrees/Notes (csv or parens): <input type="text" value={notesInputConfig} onChange={e => setNotesInputConfig(e.target.value)} style={inputStyle} placeholder="e.g., 1,3,5 or (1,b3,5)" disabled={isFetching || !isReady} size={20}/></label>
                        <label>Key: <input type="text" value={keyId} onChange={e => setKeyId(e.target.value)} style={inputStyle} placeholder="e.g., C, F#, Eb" disabled={isFetching || !isReady} size={5}/></label>
                    </div>
                     <div>
                        <label>Range Start: <input type="text" value={rangeStart} onChange={e => setRangeStart(e.target.value)} style={inputStyle} placeholder="e.g., C3" disabled={isFetching || !isReady} size={5}/></label>
                        <label>Range End: <input type="text" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} style={inputStyle} placeholder="e.g., C5" disabled={isFetching || !isReady} size={5}/></label>
                    </div>
                    <div>
                        <label>Min Interval (semitones): <input type="number" value={minIntervalInput} onChange={e => setMinIntervalInput(e.target.value)} style={inputStyle} disabled={isFetching || !isReady} /></label>
                        <label>Max Interval (semitones): <input type="number" value={maxIntervalInput} onChange={e => setMaxIntervalInput(e.target.value)} style={inputStyle} disabled={isFetching || !isReady} /></label>
                    </div>
                     {parsedDegreesResult && <p style={{fontSize: '0.9em'}}>Last Parsed Degrees: {JSON.stringify(parsedDegreesResult)}</p>}
                </section>

                <section style={sectionStyle}>
                    <h2>1. Rhythm Generator</h2>
                    <div>
                        <label>Total Beats: <input type="number" value={totalBeatsInput} onChange={e => setTotalBeatsInput(e.target.value)} style={inputStyle} /></label>
                         <label>Shortest Dur:
                            <select value={shortestDuration} onChange={e => setShortestDuration(e.target.value as DurationString)} style={inputStyle}>
                                {Object.keys(durationValues).map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </label>
                        <label>Longest Dur:
                            <select value={longestDuration} onChange={e => setLongestDuration(e.target.value as DurationString)} style={inputStyle}>
                                {Object.keys(durationValues).map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </label>
                    </div>
                     <div>
                        <label>Allow Rests: <input type="checkbox" checked={allowRests} onChange={e => setAllowRests(e.target.checked)} style={{marginRight: '10px'}} /></label>
                        {allowRests && <label>Rest Prob (0-1): <input type="number" value={restProbabilityInput} step="0.05" min="0" max="1" onChange={e => setRestProbabilityInput(e.target.value)} style={inputStyle} /></label>}
                    </div>
                    <button onClick={handleGenerateRhythm} disabled={!canGenerateSequence || !nNotesInput}>Generate Rhythm Pattern</button>
                    {rhythmResult && <pre style={preStyle}>{JSON.stringify(rhythmResult, null, 2)}</pre>}
                </section>

                <section style={sectionStyle}>
                    <h2>2. Note Sequence Generator</h2>
                    <button onClick={handleGenerateSequence} disabled={!canGenerateSequence || !nNotesInput || !notesInputConfig}>Generate Note Sequence</button>
                    {noteSequenceResult && <pre style={preStyle}>{JSON.stringify(noteSequenceResult, null, 2)}</pre>}
                </section>

                <section style={sectionStyle}>
                    <h2>3. Combine & Play</h2>
                    <button onClick={handleCreateFullSequence} disabled={!canCombine}>Create Full Playable Sequence</button>
                    {fullSequenceResult && <pre style={preStyle}>Full Sequence (Playable):<br/>{JSON.stringify(fullSequenceResult, null, 2)}</pre>}
                    {metronomeEventsResult && <pre style={preStyle}>Metronome Events:<br/>{JSON.stringify(metronomeEventsResult, null, 2)}</pre>}

                    <hr style={{margin: '15px 0'}}/>

                    <div>
                        <button onClick={handlePlay} disabled={!canPlay}>
                            {isPlaying ? 'Playing...' : 'Play Sequence'}
                        </button>
                        <button onClick={handleStop} disabled={!isPlaying} style={{ marginLeft: '10px' }}>
                            Stop
                        </button>
                         <label style={{ marginLeft: '20px' }}>
                            <input
                                type="checkbox"
                                checked={loopPlayback}
                                onChange={(e) => setLoopPlayback(e.target.checked)}
                                disabled={isPlaying}
                            />
                            Loop Playback
                        </label>
                    </div>
                    {(isPlaying || lastPlayedNote) && <p style={statusStyle}>Status: {lastPlayedNote ?? (isPlaying ? 'Playing...' : 'Idle')}</p>}
                    {loopStatus && <p style={statusStyle}>Loop Info: {loopStatus}</p>}
                </section>

            </div>

             <button onClick={async () => {
              if (toneState !== 'ready') { alert("Tone not ready"); return; }
              try {
                  await Tone.start();
                  const synth = new Tone.Synth().toDestination();
                  synth.triggerAttackRelease("C4", "8n", Tone.now());
                  console.log("Test sound triggered.");
              } catch(e) {
                  console.error("Test sound error", e);
                  setError(`Test Sound Error: ${e instanceof Error ? e.message : String(e)}`)
              }
             }} disabled={!isReady} style={{marginTop: '20px'}}>
              Test Sound (C4)
            </button>
        </div>
    );
};

export default Page;