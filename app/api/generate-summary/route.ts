import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Define specific types for FHIR Observation data to avoid using 'any'
interface CodeableConcept {
  text?: string;
}

interface ValueQuantity {
  value?: number;
  unit?: string;
}

interface ObservationComponent {
  code?: CodeableConcept;
  valueQuantity?: ValueQuantity;
}

interface ObservationResource {
  code?: CodeableConcept;
  valueQuantity?: ValueQuantity;
  effectiveDateTime?: string;
  component?: ObservationComponent[];
}

interface Observation {
  resource: ObservationResource;
}

// A more robust helper function to format FHIR observations
const formatObservationsForPrompt = (observations: Observation[]): string => {
  if (!observations || observations.length === 0) {
    return 'No observation data available.';
  }

  const formattedLines = observations.map((obs) => {
    const resource = obs.resource;
    if (!resource) return null;

    const observationName = resource.code?.text || 'Unknown Observation';
    const effectiveDate = resource.effectiveDateTime
      ? new Date(resource.effectiveDateTime).toLocaleDateString()
      : 'N/A';

    let valueString = null;

    // Case 1: The observation has a direct value (e.g., Heart Rate)
    if (resource.valueQuantity && resource.valueQuantity.value) {
      const val = resource.valueQuantity.value;
      const displayValue = typeof val === 'number' ? val.toFixed(2) : val;
      valueString = `${displayValue} ${resource.valueQuantity.unit || ''}`;
    } 
    // Case 2: The observation is a panel with components (e.g., Blood Pressure)
    else if (resource.component && resource.component.length > 0) {
      const components = resource.component.map((comp: ObservationComponent) => {
          if (comp.valueQuantity && comp.valueQuantity.value) {
            const compValue = comp.valueQuantity.value;
            const displayCompValue = typeof compValue === 'number' ? compValue.toFixed(2) : compValue;
            return `${comp.code?.text || 'component'}: ${displayCompValue} ${comp.valueQuantity.unit || ''}`;
          }
          return null;
        }).filter(Boolean).join(', ');

      if (components) {
        valueString = components;
      }
    }

    // Only return a line if we have a meaningful value to show
    if (valueString) {
      return `- ${observationName} (on ${effectiveDate}): ${valueString}`;
    }

    return null;
  });

  const finalString = formattedLines.filter(Boolean).join('\n');
  return finalString.length > 0 ? finalString : 'No valid observation data could be formatted.';
};

export async function POST(request: Request) {
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!geminiApiKey) {
    return NextResponse.json(
      { error: 'Gemini API key not configured' },
      { status: 500 }
    );
  }

  try {
    const { observations } = await request.json();

    if (!observations) {
      return NextResponse.json(
        { error: 'No observations provided' },
        { status: 400 }
      );
    }

    const formattedObservations = formatObservationsForPrompt(observations);

    if (formattedObservations === 'No valid observation data could be formatted.') {
        return NextResponse.json({ summary: 'Could not generate a summary as there was no valid clinical data to analyze.' });
    }

    const prompt = `Please summarize the following clinical observations for a healthcare provider, highlighting any notable trends or abnormal results:\n${formattedObservations}`;

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    // Using the model name we confirmed is available to your project
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const summary = response.text();

    return NextResponse.json({ summary });
  } catch (error) {
    // Final, clean error handling
    console.error("Error during Gemini API call:", error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json(
      { error: 'Failed to generate summary due to an API error.', details: errorMessage },
      { status: 500 }
    );
  }
}