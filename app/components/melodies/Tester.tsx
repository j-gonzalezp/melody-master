"use client"
import React, { useState, ChangeEvent, FormEvent, useEffect } from 'react';
import { getFirstExercise, completeAndGetNextExercise } from '@/lib/actions/groupProgressActions';

interface ExerciseParams {
    groupID: string;
    melodyLength: number;
    bpm: number;
}

interface ScoreInputProps {
  index: number;
  value: string;
  onChange: (index: number, value: string) => void;
}

const ScoreInput: React.FC<ScoreInputProps> = ({ index, value, onChange }) => (
    <div className="mb-2 flex items-center">
        <label htmlFor={`input-${index}`} className="w-24 text-sm font-medium text-gray-700">
            Score {index + 1}:
        </label>
        <input
            id={`input-${index}`}
            type="number"
            value={value}
            onChange={(e) => onChange(index, e.target.value)}
            placeholder="Enter score"
            step="any"
            min="0"
            max="1"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
        />
    </div>
);

const Tester: React.FC = () => {
    const [numberOfQuestions, setNumberOfQuestions] = useState<number>(5);
    const [inputValues, setInputValues] = useState<string[]>(Array(numberOfQuestions).fill(''));
    const [accuracy, setAccuracy] = useState<number | null>(null);
    const [currentExerciseParams, setCurrentExerciseParams] = useState<ExerciseParams | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

    useEffect(() => {
        const initializeTraining = async () => {
            setIsLoading(true);
            setError(null);

            const userId = "testuser";

            try {
                const firstExerciseResult = await getFirstExercise(
                    userId,
                    "Major",
                    "(1,3)",
                    1
                );

                if (firstExerciseResult.success) {
                    setCurrentExerciseParams(firstExerciseResult.exerciseParams);
                    setInputValues(Array(numberOfQuestions).fill(''));
                    setAccuracy(null);
                } else {
                    setError(firstExerciseResult.error);
                }
            } catch (err) {
                setError("An unexpected error occurred while loading the exercise.");
            } finally {
                setIsLoading(false);
            }
        };

        initializeTraining();
    }, [numberOfQuestions]);

    const handleInputChange = (index: number, value: string): void => {
        setInputValues(prevValues => {
            const newValues = [...prevValues];
            newValues[index] = value;
            return newValues;
        });
        setAccuracy(null);
    };

    const handleNumberOfQuestionsChange = (e: ChangeEvent<HTMLInputElement>): void => {
        const newCount = Math.max(1, parseInt(e.target.value) || 1);
        setNumberOfQuestions(newCount);
        setInputValues(currentValues => {
           const currentLength = currentValues.length;
           if (newCount > currentLength) {
               return [...currentValues, ...Array(newCount - currentLength).fill('')];
           } else {
               return currentValues.slice(0, newCount);
           }
        });
        setAccuracy(null);
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        if (!currentExerciseParams || isSubmitting) return;

        const validNumbers = inputValues
            .map(value => parseFloat(value))
            .filter(num => !isNaN(num) && num >= 0 && num <= 1);

        if (validNumbers.length !== numberOfQuestions) {
             setError("Please enter valid scores between 0 and 1 for all questions.");
             setAccuracy(null);
             return;
        }

        const avgAccuracy = validNumbers.reduce((sum, num) => sum + num, 0) / numberOfQuestions;
        setAccuracy(avgAccuracy);
        setError(null);
        setIsSubmitting(true);

        const userId = "testuser";

        try {
            const nextExerciseResult = await completeAndGetNextExercise(
                userId,
                "Major",
                currentExerciseParams.groupID,
                currentExerciseParams.melodyLength,
                avgAccuracy
            );

            if (nextExerciseResult.success) {
                setCurrentExerciseParams(nextExerciseResult.nextExercise);
                setInputValues(Array(numberOfQuestions).fill(''));
                setAccuracy(null);
            } else {
                setError(nextExerciseResult.error);
            }
        } catch (err) {
            setError("An unexpected error occurred while submitting results.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return <div className="p-6 text-center">Loading exercise...</div>;
    }

    if (error) {
        return <div className="p-6 text-center text-red-600">Error: {error}</div>;
    }

    if (!currentExerciseParams) {
        return <div className="p-6 text-center">No exercise data available.</div>;
    }

    return (
        <div className="p-6 max-w-md mx-auto bg-white rounded-xl shadow-md overflow-hidden">
            <div className="mb-4 p-4 bg-gray-100 rounded">
                <h3 className="text-lg font-semibold">Current Exercise:</h3>
                <p>Group: {currentExerciseParams.groupID}</p>
                <p>Melody Length: {currentExerciseParams.melodyLength}</p>
                <p>BPM: {currentExerciseParams.bpm}</p>
                <div className="mt-2 h-10 bg-indigo-200 flex items-center justify-center rounded"> (Audio Player Placeholder) </div>
            </div>

            <h2 className="text-xl font-bold text-gray-800 mb-4">Enter Your Answers (0-1)</h2>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                    {Array.from({ length: numberOfQuestions }).map((_, index) => (
                        <ScoreInput
                            key={index}
                            index={index}
                            value={inputValues[index]}
                            onChange={handleInputChange}
                        />
                    ))}
                </div>

                <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${isSubmitting ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'}`}
                >
                    {isSubmitting ? 'Submitting...' : 'Submit Scores & Next Exercise'}
                </button>
            </form>

            {accuracy !== null && !isSubmitting && (
                <div className="mt-4 p-4 bg-green-50 rounded-md">
                    <h3 className="text-lg font-medium text-green-800">
                        Calculated Average Accuracy: {accuracy.toFixed(2)}
                    </h3>
                </div>
            )}
        </div>
    );
};

export default Tester;