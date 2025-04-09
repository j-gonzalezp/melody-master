"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as Tone from 'tone';
import { allNotes } from '../../lib/utils';
import {
    DurationString,
    RhythmEvent,
    SequenceEvent,
    MetronomeEvent,
    MetronomeInstruments,
    SequencePlayerControls,
    durationValues,
    rhythmGenerator,
    availableNotes,
    getDegreeFromNote,
    getNoteFromDegree,
    calculateInterval,
    generateNoteSequence,
    createPiano,
    createMetronome,
    createFullSequence,
    createMetronomeEvents,
    playSequence
} from '../../lib/musicUtils';

const sectionStyle: React.CSSProperties = { border: '1px solid #ccc', padding: '15px', marginBottom: '15px', borderRadius: '5px', opacity: 1, transition: 'opacity 0.3s ease-in-out' };
const disabledSectionStyle: React.CSSProperties = { ...sectionStyle, opacity: 0.6, pointerEvents: 'none' };
const inputStyle: React.CSSProperties = { marginRight: '10px', marginBottom: '5px', padding: '5px' };
const preStyle: React.CSSProperties = { background: '#eee', padding: '10px', borderRadius: '3px', maxHeight: '200px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' };
const errorStyle: React.CSSProperties = { color: 'red', fontWeight: 'bold', marginTop: '10px'};
const statusStyle: React.CSSProperties = { color: 'blue', fontWeight: 'bold', marginTop: '10px'};

export default function Home() {
    const [totalBeats, setTotalBeats] = useState<number>(4);
    const [shortestDuration, setShortestDuration] = useState<DurationString>('16n');
    const [longestDuration, setLongestDuration] = useState<DurationString>('4n');
    const [nNotes, setNNotes] = useState<number>(8);
    const [allowRests, setAllowRests] = useState<boolean>(true);
    const [restProbability, setRestProbability] = useState<number>(0.2);
    const [rangeStart, setRangeStart] = useState<string>('C3');
    const [rangeEnd, setRangeEnd] = useState<string>('C5');
    const [keyId, setKeyId] = useState<string>('C');
    const [notesInput, setNotesInput] = useState<string>('1,3,5');
    const [noteForDegree, setNoteForDegree] = useState<string>('E4');
    const [degreeForNote, setDegreeForNote] = useState<string>('3');
    const [note1Interval, setNote1Interval] = useState<string>('C4');
    const [note2Interval, setNote2Interval] = useState<string>('G4');
    const [numNotesSequence, setNumNotesSequence] = useState<number>(12);
    const [maxInterval, setMaxInterval] = useState<number>(7);
    const [minInterval, setMinInterval] = useState<number>(1);
    const [bpm, setBpm] = useState<number>(120);
    const [loopPlayback, setLoopPlayback] = useState<boolean>(false);

    const [rhythmResult, setRhythmResult] = useState<RhythmEvent[] | null>(null);
    const [availableNotesResult, setAvailableNotesResult] = useState<string[] | null>(null);
    const [degreeResult, setDegreeResult] = useState<string | null>(null);
    const [noteFromResult, setNoteFromResult] = useState<string | null>(null);
    const [intervalResult, setIntervalResult] = useState<number | null>(null);
    const [noteSequenceResult, setNoteSequenceResult] = useState<string[] | null>(null);
    const [fullSequenceResult, setFullSequenceResult] = useState<SequenceEvent[] | null>(null);
    const [metronomeEventsResult, setMetronomeEventsResult] = useState<MetronomeEvent[] | null>(null);
    const [lastPlayedNote, setLastPlayedNote] = useState<string | null>(null);
    const [loopStatus, setLoopStatus] = useState<string>('');

    const [toneState, setToneState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const pianoRef = useRef<Tone.Sampler | null>(null);
    const metronomeRef = useRef<MetronomeInstruments | null>(null);
    const playerControlsRef = useRef<SequencePlayerControls | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const initTone = async () => {
            setToneState('loading');
            setError(null);
            console.log("Attempting to initialize Tone.js instruments...");
            try {
                pianoRef.current = createPiano();
                metronomeRef.current = createMetronome();

                await Tone.loaded();

                setToneState('ready');
                console.log("Tone.js instruments initialized and samples loaded. AudioContext might still be suspended until user interaction.");
            } catch (err) {
                console.error("Error initializing Tone.js instruments:", err);
                setError(`Error initializing Tone.js instruments: ${err instanceof Error ? err.message : String(err)}`);
                setToneState('error');
            }
        };
        initTone();

        return () => {
            console.log("Cleaning up Tone.js resources...");
            playerControlsRef.current?.stop();
            pianoRef.current?.dispose();
            metronomeRef.current?.metronome?.dispose();
            metronomeRef.current?.metronomeAccent?.dispose();
            if (Tone.Transport.state === "started") {
                Tone.Transport.stop();
            }
            Tone.Transport.cancel();
            console.log("Tone.js resources cleaned up.");
        };
    }, []);

    const handleGenerateRhythm = useCallback(() => {
        setError(null);
        try {
            const result = rhythmGenerator({
                totalBeats, shortestDuration, longestDuration, n: nNotes, allowRests, restProbability
            });
            setRhythmResult(result);
            setFullSequenceResult(null);
            setMetronomeEventsResult(null);
        } catch (err) {
            console.error("Error in handleGenerateRhythm:", err);
            setError(`Error generating rhythm: ${err instanceof Error ? err.message : String(err)}`);
            setRhythmResult(null);
        }
    }, [totalBeats, shortestDuration, longestDuration, nNotes, allowRests, restProbability]);

    const handleAvailableNotes = useCallback(() => {
        setError(null);
        try {
            const notesArray = notesInput.split(',').map(s => s.trim()).filter(s => s !== '');
            const result = availableNotes({
                allNotes, range: [rangeStart, rangeEnd], notes: notesArray, keyId
            });
            setAvailableNotesResult(result);
        } catch (err) {
            console.error("Error in handleAvailableNotes:", err);
            setError(`Error getting available notes: ${err instanceof Error ? err.message : String(err)}`);
            setAvailableNotesResult(null);
        }
    }, [notesInput, rangeStart, rangeEnd, keyId]);

    const handleGetDegree = useCallback(() => {
        setError(null);
        try {
            const result = getDegreeFromNote(noteForDegree, keyId);
            setDegreeResult(result);
        } catch (err) {
            console.error("Error in handleGetDegree:", err);
            setError(`Error getting degree: ${err instanceof Error ? err.message : String(err)}`);
            setDegreeResult(null);
        }
    }, [noteForDegree, keyId]);

    const handleGetNote = useCallback(() => {
        setError(null);
        try {
            const result = getNoteFromDegree(degreeForNote, keyId);
            setNoteFromResult(result);
        } catch (err) {
            console.error("Error in handleGetNote:", err);
            setError(`Error getting note: ${err instanceof Error ? err.message : String(err)}`);
            setNoteFromResult(null);
        }
    }, [degreeForNote, keyId]);

    const handleCalculateInterval = useCallback(() => {
        setError(null);
        try {
            const result = calculateInterval(note1Interval, note2Interval);
            setIntervalResult(result);
        } catch (err) {
            console.error("Error in handleCalculateInterval:", err);
            setError(`Error calculating interval: ${err instanceof Error ? err.message : String(err)}`);
            setIntervalResult(null);
        }
    }, [note1Interval, note2Interval]);

    const handleGenerateSequence = useCallback(() => {
        setError(null);
        try {
            const notesArray = notesInput.split(',').map(s => s.trim()).filter(s => s !== '');
            const result = generateNoteSequence({
                keyId, notes: notesArray, range: [rangeStart, rangeEnd],
                numberOfNotes: numNotesSequence, maxInterval, minInterval
            });
            setNoteSequenceResult(result);
            setFullSequenceResult(null);
            setMetronomeEventsResult(null);
        } catch (err) {
            console.error("Error in handleGenerateSequence:", err);
            setError(`Error generating sequence: ${err instanceof Error ? err.message : String(err)}`);
            setNoteSequenceResult(null);
        }
    }, [keyId, notesInput, rangeStart, rangeEnd, numNotesSequence, maxInterval, minInterval]);

    const handleCreateFullSequence = useCallback(() => {
        setError(null);
        if (!noteSequenceResult || !rhythmResult) {
            setError("Please generate both a Note Sequence and a Rhythm Pattern first.");
            setFullSequenceResult(null);
            setMetronomeEventsResult(null);
            return;
        }
        try {
            const result = createFullSequence(noteSequenceResult, rhythmResult);
            setFullSequenceResult(result);
             const calculatedTotalBeats = result.reduce((sum, item) => sum + item.value, 0);
             if (calculatedTotalBeats > 0) {
                 const metroEvents = createMetronomeEvents(calculatedTotalBeats);
                 setMetronomeEventsResult(metroEvents);
             } else {
                 setMetronomeEventsResult(null);
                 console.warn("Generated full sequence has zero total beats.");
             }
        } catch (err) {
            console.error("Error in handleCreateFullSequence:", err);
            setError(`Error creating full sequence: ${err instanceof Error ? err.message : String(err)}`);
            setFullSequenceResult(null);
            setMetronomeEventsResult(null);
        }
    }, [noteSequenceResult, rhythmResult]);

     const handlePlay = useCallback(async () => {
        setError(null);
        setLastPlayedNote(null);
        setLoopStatus('');

        if (toneState !== 'ready' || !pianoRef.current || !fullSequenceResult) {
            setError("Tone.js not ready, or no full sequence generated to play.");
            console.error("Play precondition failed:", { toneState, piano: !!pianoRef.current, fullSequence: !!fullSequenceResult });
            return;
        }
        if (isPlaying) {
            console.warn("Already playing.");
            return;
        }

        try {
            console.log("Play button clicked. Ensuring AudioContext is running...");
            await Tone.start();
            console.log("AudioContext state after Tone.start():", Tone.context.state);
             if (Tone.context.state !== 'running') {
                throw new Error("AudioContext failed to start or resume.");
            }

            playerControlsRef.current?.stop();

             console.log("Calling playSequence...");
             const controls = await playSequence({
                generatedNotes: noteSequenceResult ?? [],
                fullSequence: fullSequenceResult,
                piano: pianoRef.current,
                metronomeInstruments: metronomeRef.current ?? undefined,
                loop: loopPlayback,
                bpm: bpm,
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
                       setLoopStatus(prev => `${prev} | Loop ${count + 1} ended @ ${time.toFixed(2)}`);
                     }, time);
                 }
             });

            controls.onStop = () => {
                setIsPlaying(false);
                Tone.Draw.schedule(() => {
                    setLastPlayedNote('Playback stopped.');
                    setLoopStatus(prev => prev ? `${prev} | Stopped.` : 'Stopped.');
                }, Tone.now());
                console.log("Playback stopped via onStop callback.");
                playerControlsRef.current = null;
            };

            playerControlsRef.current = controls;
            controls.play();
            setIsPlaying(true);
            setLastPlayedNote('Playback starting...');
            console.log("Playback initiated.");

        } catch (err) {
             console.error("Error during handlePlay:", err);
            setError(`Error playing sequence: ${err instanceof Error ? err.message : String(err)}`);
            setIsPlaying(false);
             if (Tone.Transport.state === "started") {
                Tone.Transport.stop();
            }
            Tone.Transport.cancel();
        }

    }, [toneState, isPlaying, fullSequenceResult, noteSequenceResult, loopPlayback, bpm]);

     const handleStop = useCallback(() => {
        console.log("Stop button clicked.");
        if (playerControlsRef.current) {
             playerControlsRef.current.stop();
        } else if (Tone.Transport.state === 'started') {
             console.warn("Player controls ref missing, stopping Transport directly.");
             Tone.Transport.stop();
             Tone.Transport.cancel();
             setIsPlaying(false);
             setLastPlayedNote('Playback force stopped (no controls ref).');
        } else {
            console.log("Nothing to stop.");
        }
    }, []);

    const isReady = toneState === 'ready';
    const isLoading = toneState === 'loading';

    return (
        <main style={{ padding: '20px', fontFamily: 'sans-serif' }}>
            <h1>Music Utils Test Interface</h1>

             {isLoading && <p style={statusStyle}>Loading Tone.js instruments... Please wait.</p>}
             {toneState === 'error' && <p style={errorStyle}>Tone.js Initialization Error: {error}</p>}
             {isReady && <p style={statusStyle}>Tone.js Ready. You may need to click 'Play' once to fully enable audio.</p>}
             {error && toneState !== 'error' && <p style={errorStyle}>Runtime Error: {error}</p>}

             <div style={isReady ? {} : disabledSectionStyle}>

                <section style={sectionStyle}>
                    <h2>Rhythm Generator</h2>
                    <div>
                        <label>Total Beats: <input type="number" value={totalBeats} onChange={e => setTotalBeats(Number(e.target.value))} style={inputStyle} /></label>
                        <label>N Notes: <input type="number" value={nNotes} onChange={e => setNNotes(Number(e.target.value))} style={inputStyle} /></label>
                        <label>Shortest:
                            <select value={shortestDuration} onChange={e => setShortestDuration(e.target.value as DurationString)} style={inputStyle}>
                                {Object.keys(durationValues).map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </label>
                        <label>Longest:
                            <select value={longestDuration} onChange={e => setLongestDuration(e.target.value as DurationString)} style={inputStyle}>
                                {Object.keys(durationValues).map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </label>
                        <label>Allow Rests: <input type="checkbox" checked={allowRests} onChange={e => setAllowRests(e.target.checked)} style={{marginRight: '10px'}} /></label>
                        {allowRests && <label>Rest Prob: <input type="number" value={restProbability} step="0.05" min="0" max="1" onChange={e => setRestProbability(Number(e.target.value))} style={inputStyle} /></label>}
                    </div>
                    <button onClick={handleGenerateRhythm} disabled={!isReady || isLoading}>Generate Rhythm</button>
                    {rhythmResult && <pre style={preStyle}>{JSON.stringify(rhythmResult, null, 2)}</pre>}
                </section>

                <section style={sectionStyle}>
                    <h2>Note Selection / Generation</h2>
                    <div>
                        <label>Range Start: <input type="text" value={rangeStart} onChange={e => setRangeStart(e.target.value)} style={inputStyle} placeholder="e.g., C3"/></label>
                        <label>Range End: <input type="text" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} style={inputStyle} placeholder="e.g., C5"/></label>
                        <label>Key: <input type="text" value={keyId} onChange={e => setKeyId(e.target.value)} style={inputStyle} placeholder="e.g., C, F#, Eb"/></label>
                        <label>Allowed Notes/Degrees (csv): <input type="text" value={notesInput} onChange={e => setNotesInput(e.target.value)} style={inputStyle} placeholder="e.g., C,E,G or 1,3,5"/></label>
                    </div>
                    <button onClick={handleAvailableNotes} disabled={!isReady || isLoading}>Get Available Notes</button>
                    {availableNotesResult && <pre style={preStyle}>{JSON.stringify(availableNotesResult, null, 2)}</pre>}

                    <hr style={{margin: '15px 0'}}/>

                    <div>
                        <label>Note for Degree: <input type="text" value={noteForDegree} onChange={e => setNoteForDegree(e.target.value)} style={inputStyle} placeholder="e.g., E4"/></label>
                        <button onClick={handleGetDegree} disabled={!isReady || isLoading}>Get Degree from Note</button>
                        {degreeResult && <p>Result: <strong>{degreeResult}</strong></p>}
                    </div>
                    <div style={{marginTop: '10px'}}>
                        <label>Degree for Note: <input type="text" value={degreeForNote} onChange={e => setDegreeForNote(e.target.value)} style={inputStyle} placeholder="e.g., 3, 5#, b7"/></label>
                        <button onClick={handleGetNote} disabled={!isReady || isLoading}>Get Note from Degree</button>
                        {noteFromResult && <p>Result: <strong>{noteFromResult}</strong></p>}
                    </div>

                    <hr style={{margin: '15px 0'}}/>

                    <div>
                        <label>Note 1: <input type="text" value={note1Interval} onChange={e => setNote1Interval(e.target.value)} style={inputStyle} placeholder="e.g., C4"/></label>
                        <label>Note 2: <input type="text" value={note2Interval} onChange={e => setNote2Interval(e.target.value)} style={inputStyle} placeholder="e.g., G4"/></label>
                        <button onClick={handleCalculateInterval} disabled={!isReady || isLoading}>Calculate Interval (Semitones)</button>
                        {intervalResult !== null && <p>Result: <strong>{intervalResult}</strong> semitones</p>}
                    </div>

                    <hr style={{margin: '15px 0'}}/>

                    <div>
                        <label>Num Notes: <input type="number" value={numNotesSequence} onChange={e => setNumNotesSequence(Number(e.target.value))} style={inputStyle} /></label>
                        <label>Min Interval: <input type="number" value={minInterval} onChange={e => setMinInterval(Number(e.target.value))} style={inputStyle} /></label>
                        <label>Max Interval: <input type="number" value={maxInterval} onChange={e => setMaxInterval(Number(e.target.value))} style={inputStyle} /></label>
                        <button onClick={handleGenerateSequence} disabled={!isReady || isLoading}>Generate Note Sequence</button>
                        {noteSequenceResult && <pre style={preStyle}>{JSON.stringify(noteSequenceResult, null, 2)}</pre>}
                    </div>
                </section>

                <section style={sectionStyle}>
                    <h2>Sequence Combination & Playback</h2>
                    <button onClick={handleCreateFullSequence} disabled={!isReady || isLoading || !noteSequenceResult || !rhythmResult}>Create Full Sequence</button>
                    {fullSequenceResult && <pre style={preStyle}>{JSON.stringify(fullSequenceResult, null, 2)}</pre>}
                    {metronomeEventsResult && (
                        <>
                            <h4>Metronome Events (for generated sequence)</h4>
                            <pre style={preStyle}>{JSON.stringify(metronomeEventsResult, null, 2)}</pre>
                        </>
                    )}

                    <hr style={{margin: '15px 0'}}/>

                    <div>
                        <label>BPM: <input type="number" value={bpm} onChange={e => setBpm(Number(e.target.value))} style={inputStyle} /></label>
                        <label>Loop: <input type="checkbox" checked={loopPlayback} 
                        onChange={e => setLoopPlayback(e.target.checked)} 
                        style={{marginRight: '10px'}} /></label>
                        <button onClick={handlePlay} disabled={!isReady || isLoading || !fullSequenceResult || isPlaying}>
                            Play Sequence
                            </button>
                        <button onClick={handleStop} disabled={!isReady || isLoading || !isPlaying}>Stop Sequence</button>
                    </div>
                    {lastPlayedNote && <p style={{marginTop: '10px'}}>Status: {lastPlayedNote}</p>}
                    {loopStatus && <p style={{marginTop: '5px'}}>Loop: {loopStatus}</p>}
                </section>

            </div>

        </main>
    );
}