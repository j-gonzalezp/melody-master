// ./components/CadencePlayer.tsx (Reconstrucción)
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as Tone from 'tone';

// --- Props Interface ---
interface CadencePlayerProps {
  musicalKey: string;
  bpm?: number;
  onCadenceComplete?: () => void;
  /** A pre-loaded Tone.Sampler instance from parent */
  pianoInstrument: Tone.Sampler | null;
  disabled?: boolean;
}

// --- Event Type for Tone.Part ---
type CadenceEvent = [time: number, chord: string[]];

// --- The Component ---
const CadencePlayer: React.FC<CadencePlayerProps> = ({
  musicalKey,
  bpm = 120,
  onCadenceComplete,
  pianoInstrument,
  disabled = false,
}) => {
  // --- State ---
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // --- Refs ---
  // Use a ref to store the passed instrument instance
  const pianoRef = useRef<Tone.Sampler | null>(pianoInstrument);
  // Ref for the Tone.Part instance
  const partRef = useRef<Tone.Part<CadenceEvent> | null>(null);
  // Ref to track the ID of the scheduled completion callback
  const completionEventIdRef = useRef<number | null>(null);
  // Ref to track the actual playing state, avoiding stale closures in callbacks
  const isPlayingRef = useRef<boolean>(false);

  // --- Sync External Prop to Internal Ref ---
  // Update the internal piano ref if the prop changes
  useEffect(() => {
    pianoRef.current = pianoInstrument;
    // If the instrument is removed while playing, stop the cadence
    if (!pianoInstrument && isPlayingRef.current) {
      console.warn("CadencePlayer: Piano instrument removed during playback. Stopping.");
      // We need stopCadence here, define it below or call cleanup logic directly
      // For now, just log and reset state
      if (partRef.current) {
          partRef.current.stop();
          partRef.current.dispose();
          partRef.current = null;
      }
       if (completionEventIdRef.current !== null) {
          Tone.Transport.clear(completionEventIdRef.current);
          completionEventIdRef.current = null;
      }
      setIsPlaying(false);
      isPlayingRef.current = false;
    }
  }, [pianoInstrument]); // Only depends on the instrument prop

  // --- Utility Functions (Memoized) ---
  const getNoteAtInterval = useCallback((baseNote: string, semitones: number): string => {
    // (Implementation is likely correct, keep as is)
    const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const noteName = baseNote.replace(/\d+$/, '');
    const octaveMatch = baseNote.match(/\d+$/);
    if (!octaveMatch) return baseNote;
    const octave = parseInt(octaveMatch[0]);
    let noteIndex = notes.indexOf(noteName);
    if (noteIndex === -1) return baseNote;
    noteIndex += semitones;
    const octaveShift = Math.floor(noteIndex / 12);
    noteIndex = ((noteIndex % 12) + 12) % 12;
    return notes[noteIndex] + (octave + octaveShift);
  }, []); // No dependencies, pure function

  const getCadenceChords = useCallback((): string[][] => {
    // (Implementation depends only on props and getNoteAtInterval)
    if (!musicalKey) return [];
    const chromaticNotes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const keyIndex = chromaticNotes.indexOf(musicalKey);
    if (keyIndex === -1) { console.error(`CadencePlayer: Invalid key - ${musicalKey}`); return []; }
    const tonic = musicalKey + "4"; // Using fixed octave 4
    const subdominant = getNoteAtInterval(tonic, 5);
    const dominant = getNoteAtInterval(tonic, 7);
    const chords = [ /* I-IV-V-I */
      [tonic, getNoteAtInterval(tonic, 4), getNoteAtInterval(tonic, 7)],
      [subdominant, getNoteAtInterval(subdominant, 4), getNoteAtInterval(subdominant, 7)],
      [dominant, getNoteAtInterval(dominant, 4), getNoteAtInterval(dominant, 7)],
      [tonic, getNoteAtInterval(tonic, 4), getNoteAtInterval(tonic, 7)]
    ];
    return chords;
  }, [musicalKey, getNoteAtInterval]); // Correct dependencies

  // --- Core Logic Functions (Memoized) ---

  // Function to stop playback and clean up Tone.js objects
  const stopPlayback = useCallback((triggerCompletionCallback = true) => {
    console.log("CadencePlayer: stopPlayback called");
    // 1. Clear scheduled completion event
    if (completionEventIdRef.current !== null) {
      Tone.Transport.clear(completionEventIdRef.current);
      completionEventIdRef.current = null;
      // console.log("CadencePlayer: Cleared completion event ID");
    }

    // 2. Stop and dispose the Tone.Part
    if (partRef.current) {
      // console.log("CadencePlayer: Stopping and disposing part");
      if (!partRef.current.disposed) {
          try {
            partRef.current.stop(); // Stop playback scheduled by the part
            partRef.current.dispose(); // Release Tone.js resources
          } catch (e) {
              console.warn("CadencePlayer: Error during part stop/dispose", e);
          }
      }
      partRef.current = null; // Clear the ref
    } else {
        // console.log("CadencePlayer: No active part found to stop.");
    }

    // 3. Update state and refs
    // Check state before setting to potentially avoid re-render if already false
    if (isPlayingRef.current) {
      setIsPlaying(false);
      isPlayingRef.current = false;
      // console.log("CadencePlayer: Updated playing state to false");
    }

    // 4. Trigger callback if needed
    if (triggerCompletionCallback && onCadenceComplete) {
      // console.log("CadencePlayer: Triggering onCadenceComplete callback.");
      onCadenceComplete();
    }
    // DO NOT stop Tone.Transport globally here
  }, [onCadenceComplete]); // Depends only on the callback prop

  // Function to start playback
  const startPlayback = useCallback(async () => {
    // --- Pre-checks ---
    if (!pianoRef.current) {
      console.warn("CadencePlayer: Cannot play, piano instrument is not available.");
      return;
    }
    if (isPlayingRef.current) {
       console.log("CadencePlayer: Already playing, stop command issued.");
       stopPlayback(false); // Stop without triggering completion
       return;
    }
     // Check AudioContext state and try to start if needed
    if (Tone.context.state !== 'running') {
      try {
        await Tone.start();
        console.log("CadencePlayer: AudioContext started.");
      } catch (e) {
        console.error("CadencePlayer: Failed to start AudioContext.", e);
        
        return;
      }
    }

    // --- Cleanup previous instances (safety net) ---
    stopPlayback(false); // Ensure any lingering parts/callbacks are cleared

    // --- Get chords ---
    const chords = getCadenceChords();
    if (chords.length === 0) {
      console.error("CadencePlayer: Cannot play, no chords generated.");
      return;
    }

    // --- Set Transport BPM (Affects global transport) ---
    // Consider if this should be managed externally if multiple tempos are needed
    Tone.Transport.bpm.value = bpm;
    // console.log(`CadencePlayer: Set Transport BPM to ${bpm}`);

    // --- Create and Schedule Tone.Part ---
    try {
        const noteDurationSeconds = Tone.Time("4n").toSeconds(); // Half note duration based on current BPM
        const events: CadenceEvent[] = chords.map(
            (chord: string[], i: number): CadenceEvent => [noteDurationSeconds * i, chord]
        );
        const totalDuration = noteDurationSeconds * chords.length;

        // Create the Tone.Part
        partRef.current = new Tone.Part<CadenceEvent>((time: number, event: string[]) => {
            // Callback executed for each chord in the sequence
            if (pianoRef.current && isPlayingRef.current && !pianoRef.current.disposed) {
              // Add a tiny offset to avoid potential timing issues/clicks
              pianoRef.current.triggerAttackRelease(event, "4n", time + 0.01);
            }
        }, events);

        // Schedule the part to start at the *next* measure or beat for cleaner sync?
        // Or start immediately relative to current transport time (simpler):
        partRef.current.start(0); // Start at transport time 0 (relative)

        // --- Schedule Completion ---
        // Schedule the stopPlayback function to run after the part finishes
        completionEventIdRef.current = Tone.Transport.scheduleOnce((time) => {
            // console.log(`CadencePlayer: Scheduled completion event fired at ${time.toFixed(2)}`);
            // Check isPlayingRef inside the callback, as state might be stale
            if (isPlayingRef.current) {
              stopPlayback(true); // Natural completion, trigger callback
            }
            completionEventIdRef.current = null; // Clear the ID after execution
        }, `+${totalDuration + 0.1}`); // Schedule relative to *now* + duration + buffer

        // --- Update State & Start Transport ---
        setIsPlaying(true);
        isPlayingRef.current = true;
        // console.log("CadencePlayer: Playback sequence scheduled.");

        // Start the global transport only if it's not already running
        if (Tone.Transport.state !== "started") {
          // console.log("CadencePlayer: Starting global Tone.Transport.");
          Tone.Transport.start(Tone.now()); // Start immediately
        } else {
          // console.log("CadencePlayer: Global Tone.Transport already running.");
        }

    } catch (err) {
      console.error("CadencePlayer: Error during playback scheduling:", err);
      stopPlayback(false); // Clean up if scheduling failed
    }

  }, [bpm, getCadenceChords, stopPlayback]); // Dependencies: bpm, chord generator, stop function

  // --- Click Handler ---
  const handleButtonClick = useCallback(() => {
    if (isPlayingRef.current) {
      stopPlayback(false); // Stop manually
    } else {
      startPlayback(); // Start playback
    }
  }, [startPlayback, stopPlayback]); // Depends on start/stop functions

  // --- Unmount Cleanup Effect ---
  // This useEffect's *only* job is to clean up when the component unmounts.
  useEffect(() => {
    return () => {
      console.log("CadencePlayer: Unmounting. Cleaning up...");
      // Call the stop function, ensuring no completion callback is triggered
      stopPlayback(false);
      // Do NOT dispose the pianoInstrument here - it's managed by the parent.
    };
  }, [stopPlayback]); // Dependency: the cleanup function itself

  // --- Render ---
  return (
    <button
      type="button"
      onClick={handleButtonClick}
      disabled={disabled || !pianoRef.current} // Disable if parent disables or no instrument
      aria-label={isPlaying ? 'Stop playing cadence' : 'Play cadence'}
      style={{
         marginLeft: '10px',
         padding: '8px 12px',
         cursor: (disabled || !pianoRef.current) ? 'not-allowed' : 'pointer',
         opacity: (disabled || !pianoRef.current) ? 0.6 : 1,
         backgroundColor: isPlaying ? '#f87171' : '#e5e7eb', // Example: Red when playing
         color: isPlaying ? 'white' : 'black',
         border: '1px solid transparent',
         borderRadius: '4px'
        }}
    >
      {isPlaying ? 'Stop Cadence' : 'Play Cadence'}
    </button>
  );
};

export default CadencePlayer;