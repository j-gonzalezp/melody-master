
"use client"; // Necesario para usar State y Handlers en el cliente

import React, { useState, useCallback, ChangeEvent } from 'react';
import {
    rhythmGenerator,
    durationValues,
    // No importamos durationNotations, RhythmGeneratorOptions, RhythmEvent directamente
} from '../lib/melodyGenerators'; // <-- Ajusta esta ruta si tu archivo está en otro lugar

// --- Inferir tipos necesarios desde la función exportada ---
// Infiere el tipo del objeto de opciones (el primer parámetro)
// Usamos NonNullable porque el parámetro es opcional con default {}, pero queremos el tipo del objeto interno
type RhythmGeneratorOptions = NonNullable<Parameters<typeof rhythmGenerator>[0]>;
// Infiere el tipo del array devuelto y luego obtiene el tipo del elemento individual
type RhythmEvent = ReturnType<typeof rhythmGenerator>[number];
// ----------------------------------------------------------

// Derivamos las notaciones de las claves del objeto exportado
const durationNotations = Object.keys(durationValues);
// Definimos un tipo más específico para las claves de durationValues
type DurationNotation = keyof typeof durationValues;


export default function RhythmTesterPage() {
    // Estados para cada opción del generador
    const [totalBeats, setTotalBeats] = useState<number>(4);
    // Aseguramos que los valores iniciales sean claves válidas de durationValues
    const [shortestDuration, setShortestDuration] = useState<DurationNotation>("16n");
    const [longestDuration, setLongestDuration] = useState<DurationNotation>("2n");
    const [n, setN] = useState<number>(4); // Target notes
    const [allowRests, setAllowRests] = useState<boolean>(true);
    const [restProbability, setRestProbability] = useState<number>(0.2);

    // Estado para guardar el resultado (usando el tipo inferido)
    const [generatedRhythm, setGeneratedRhythm] = useState<RhythmEvent[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Función para manejar la generación
    const handleGenerate = useCallback(() => {
        setError(null); // Limpia errores previos
        setGeneratedRhythm(null); // Limpia resultados previos

        // Construimos el objeto de opciones usando los estados actuales
        // TypeScript verificará que coincida con el tipo inferido RhythmGeneratorOptions
        const options: RhythmGeneratorOptions = {
            totalBeats,
            shortestDuration,
            longestDuration,
            n,
            allowRests,
            restProbability,
        };

        console.log("Generating with options:", options);

        try {
            // Llamamos a la función importada
            const result: RhythmEvent[] = rhythmGenerator(options); // El tipo de result es inferido correctamente
            setGeneratedRhythm(result);
            console.log("Generated result:", result);

            // Opcional: Calcular y mostrar la suma de duraciones generadas
            const sumGenerated = result.reduce((acc, ev) => acc + ev.value, 0);
            console.log(`Total duration of generated events: ${sumGenerated}`);
            if (allowRests && Math.abs(sumGenerated - totalBeats) > 1e-9) {
                console.warn(`Generated duration (${sumGenerated}) differs significantly from target totalBeats (${totalBeats})`);
            }

        } catch (err: any) {
            console.error("Error generating rhythm:", err);
            setError(err.message || "An unknown error occurred during generation.");
        }
    }, [totalBeats, shortestDuration, longestDuration, n, allowRests, restProbability]);

    // --- Handlers para asegurar tipos en Selects ---
     const handleSelectChange = (setter: React.Dispatch<React.SetStateAction<DurationNotation>>) =>
         (event: ChangeEvent<HTMLSelectElement>) => {
           // Aseguramos que el valor sea una de las claves válidas antes de hacer set
           const value = event.target.value as DurationNotation;
           if (durationNotations.includes(value)) {
               setter(value);
           } else {
               console.error("Invalid duration selected:", value);
               // Opcional: podrías resetear a un valor por defecto o mostrar un error
           }
       };

    // --- Estilos (igual que antes) ---
    const inputStyle: React.CSSProperties = {
        margin: '5px',
        padding: '8px',
        border: '1px solid #ccc',
        borderRadius: '4px',
    };
    const labelStyle: React.CSSProperties = {
        minWidth: '150px',
        display: 'inline-block',
        marginRight: '10px',
        textAlign: 'right',
    };
     const containerStyle: React.CSSProperties = {
        padding: '20px',
        fontFamily: 'sans-serif',
    };
     const buttonStyle: React.CSSProperties = {
        padding: '10px 20px',
        marginTop: '15px',
        cursor: 'pointer',
        backgroundColor: '#0070f3',
        color: 'white',
        border: 'none',
        borderRadius: '5px',
        fontSize: '1rem'
    };
     const resultStyle: React.CSSProperties = {
        marginTop: '20px',
        padding: '15px',
        backgroundColor: '#f0f0f0',
        border: '1px solid #ddd',
        borderRadius: '5px',
        whiteSpace: 'pre-wrap', // Para mostrar bien el JSON
        wordWrap: 'break-word', // Para que no se desborde
        maxHeight: '400px',
        overflowY: 'auto'
    };
     const errorStyle: React.CSSProperties = {
        color: 'red',
        marginTop: '10px',
        fontWeight: 'bold'
     }
    // --- Renderizado ---
    return (
        <div style={containerStyle}>
            <h1>Rhythm Generator Tester</h1>

            {/* --- Controles --- */}
            <div>
                <label style={labelStyle} htmlFor="totalBeats">Total Beats:</label>
                <input
                    style={inputStyle}
                    type="number"
                    id="totalBeats"
                    value={totalBeats}
                    onChange={(e) => setTotalBeats(parseFloat(e.target.value) || 0)} // Usar parseFloat para permitir decimales
                    min="0"
                    step="0.125" // Un paso razonable basado en 32n
                />
            </div>

             <div>
                <label style={labelStyle} htmlFor="nNotes">Target Notes (n):</label>
                <input
                    style={inputStyle}
                    type="number"
                    id="nNotes"
                    value={n}
                    onChange={(e) => setN(parseInt(e.target.value, 10) || 0)}
                    min="0"
                    step="1"
                />
                 <small style={{marginLeft: '10px'}}> (Exact notes if Rests=false; Target if Rests=true)</small>
            </div>

            <div>
                <label style={labelStyle} htmlFor="shortest">Shortest Duration:</label>
                <select
                    style={inputStyle}
                    id="shortest"
                    value={shortestDuration}
                    onChange={handleSelectChange(setShortestDuration)} // Usar handler específico
                >
                    {/* Tipamos 'notation' explícitamente como string */}
                    {durationNotations.map((notation: string) => (
                        <option key={notation} value={notation}>
                            {/* Usamos aserción de tipo para acceder a durationValues */}
                            {notation} ({durationValues[notation as DurationNotation]} beats)
                        </option>
                    ))}
                </select>
            </div>

            <div>
                <label style={labelStyle} htmlFor="longest">Longest Duration:</label>
                <select
                    style={inputStyle}
                    id="longest"
                    value={longestDuration}
                    onChange={handleSelectChange(setLongestDuration)} // Usar handler específico
                >
                    {/* Tipamos 'notation' explícitamente como string */}
                    {durationNotations.map((notation: string) => (
                         <option key={notation} value={notation}>
                            {/* Usamos aserción de tipo para acceder a durationValues */}
                            {notation} ({durationValues[notation as DurationNotation]} beats)
                        </option>
                    ))}
                </select>
            </div>

             <div>
                <label style={labelStyle} htmlFor="allowRests">Allow Rests:</label>
                <input
                    style={{...inputStyle, width: 'auto', verticalAlign: 'middle'}}
                    type="checkbox"
                    id="allowRests"
                    checked={allowRests}
                    onChange={(e) => setAllowRests(e.target.checked)}
                />
            </div>

            {allowRests && ( // Solo mostrar si se permiten rests
                <div>
                    <label style={labelStyle} htmlFor="restProb">Rest Probability:</label>
                    <input
                        style={inputStyle}
                        type="number"
                        id="restProb"
                        value={restProbability}
                        onChange={(e) => setRestProbability(parseFloat(e.target.value) || 0)}
                        min="0"
                        max="1"
                        step="0.05"
                    />
                </div>
            )}

            {/* --- Botón y Resultados --- */}
            <button style={buttonStyle} onClick={handleGenerate}>
                Generate Rhythm
            </button>

            {error && (
                <div style={errorStyle}>Error: {error}</div>
            )}

            {generatedRhythm && (
                <div>
                    <h2>Generated Rhythm:</h2>
                    <pre style={resultStyle}>
                        {JSON.stringify(generatedRhythm, null, 2)}
                    </pre>
                    {/* Resumen opcional */}
                    <p>
                        Total Duration of Events: {generatedRhythm.reduce((sum, ev) => sum + ev.value, 0).toFixed(4)} beats
                    </p>
                    <p>
                        Number of Notes: {generatedRhythm.filter(ev => ev.type === 'note').length}
                    </p>
                     <p>
                        Number of Rests: {generatedRhythm.filter(ev => ev.type === 'rest').length}
                    </p>
                </div>
            )}
        </div>
    );
}