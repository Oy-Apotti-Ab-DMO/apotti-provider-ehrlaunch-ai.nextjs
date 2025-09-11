import { NextRequest, NextResponse } from 'next/server';
import { patientEverything } from '@/app/lib/fhir/service';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Define interfaces for FHIR resources to avoid using 'any'
interface Coding {
  display?: string;
}

interface CodeableConcept {
  text?: string;
  coding?: Coding[];
}

interface Quantity {
  value?: number;
  unit?: string;
}

interface Observation {
  resourceType: 'Observation';
  code?: CodeableConcept;
  valueQuantity?: Quantity;
  valueCodeableConcept?: CodeableConcept;
  effectiveDateTime?: string;
}

interface BundleEntry {
  resource: Observation | { resourceType: string; [key: string]: unknown };
}

// Get the API key from environment variables
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const systemPrompt = `
ROLE
You are a clinical data retrieval and summarization assistant. You must produce patient-centric summaries strictly from FHIR data returned by tools. Never infer or guess facts not present in tool results. All claims must be traceable to specific FHIR resources (provenance).

CONTEXT
- OAuth2 / SMART on FHIR auth is handled by the host application.
- A FHIR R4/R5 server is available through the tools defined below.
- If data is insufficient, say so clearly and request the minimal next data (e.g., different date window, specific resource types).
- Do not provide diagnoses or treatment recommendations. Present facts, trends, and reference ranges only when supplied by the data.

FOCUSED RESOURCE SCOPE
Retrieve and synthesize, at minimum, the following resources:
- AllergyIntolerance (current allergies)
- CarePlan (active)
- CareTeam (active)
- Condition (active + relevant history)
- DiagnosticReport (labs/pathology, last 12 months)
- Encounter (last 12 months; type/reason)
- Goal (active/recent)
- Immunization (lifetime; emphasize recent)
- MedicationDispense (recent dispenses; last 6–12 months)
- MedicationRequest (current/active + recently stopped)
- Observation (vital-signs and laboratory)
- Procedure (past 2 years)
- ProcedureRequest / ServiceRequest (active or recent procedure orders)

TASK — WHAT TO DELIVER
Produce a concise current-state, patient-centric summary for the requested window covering only the focused resources:
1) Active Problems (Condition): name + status (onset/abatement if available).
2) Medications:
   - MedicationRequest (current/active): name + dose/route/frequency where available; list recently stopped.
   - MedicationDispense (recent): last dispenses (drug, quantity, when).
3) Allergies (AllergyIntolerance): agent, criticality, reactions (if present).
4) Encounters: last relevant visits (type, date, reason).
5) Procedures (Procedure): key procedures (last 2y); include date and code text.
6) Procedure Orders (ServiceRequest/ProcedureRequest): active/recent orders; status.
7) Observations:
   - Vital signs: latest + short trend (3–5 items if present).
   - Laboratories: highlight key panels/results (latest + short trend), but avoid clinical interpretation beyond ranges provided.
8) Diagnostic Reports: brief titles and dates; if a short conclusion is embedded in the resource, include a one-liner.
9) CarePlan: active plans; summarize title, status, and major activities if easily available.
10) CareTeam: members/roles if available.
11) Goals: active/recent goals (target & status).
12) Immunizations: notable recent vaccinations.
13) Data Quality Notes: missingness, unit anomalies, duplicates, absent ranges.
14) SOURCES: list all resource references underpinning statements.
15) Clinical Summary Prose: A brief, narrative summary of the patient's clinical status, highlighting trends and abnormalities as requested in the final prompt.

CONSTRAINTS
- No diagnoses or treatment recommendations.
- If a section lacks data, state “No data for window”.
- Do not reveal tokens or secrets.

OUTPUT FORMAT
Produce TWO parts in order:
(A) Human-readable (Markdown):
# Focused Patient Summary (patient: {{PATIENT_ID}}, window: {{START}}–{{END}})
...
(B) Machine-readable JSON (in a fenced code block).
{
  "patient_id": "{{PATIENT_ID}}",
  ...
}
`;

export async function GET(request: NextRequest) {
  console.log('--- generate-comprehensive-summary route handler started ---');
  const patientId = request.nextUrl.searchParams.get('patientId');
  const accessToken = request.headers.get('Authorization')?.split(' ')[1];

  console.log(`Patient ID: ${patientId}`);
  console.log(`Access Token present: ${!!accessToken}`);

  if (!patientId || !accessToken) {
    return NextResponse.json({ error: 'Missing patient ID or access token' }, { status: 400 });
  }

  try {
    // Step 1: Fetch the comprehensive FHIR bundle
    console.log('Fetching FHIR data...');
    const bundle = await patientEverything(patientId, accessToken);
    console.log(`FHIR bundle fetched. Number of entries: ${bundle.entry?.length || 0}`);

    // Step 2: Prepare the prompt for the generative model
    const today = new Date().toISOString().split('T')[0];

    // Format observations for the prompt
    const observations = bundle.entry?.filter((e: BundleEntry) => e.resource.resourceType === 'Observation') || [];
    const formattedObservations = observations.map((obs: BundleEntry) => {
      const resource = obs.resource as Observation;
      const code = resource.code?.text || resource.code?.coding?.[0]?.display || 'N/A';
      const value = resource.valueQuantity ? `${resource.valueQuantity.value} ${resource.valueQuantity.unit}` : (resource.valueCodeableConcept?.text || 'N/A');
      const date = resource.effectiveDateTime ? new Date(resource.effectiveDateTime).toLocaleDateString() : 'N/A';
      return `- ${date}: ${code} - ${value}`;
    }).join('\n');

    const prompt = `
      ${systemPrompt}

      INPUTS (fill BEFORE running)
      - PATIENT_ID = ${patientId}
      - START = 2023-01-01 (example, adjust as needed)
      - END   = ${today}

      TOOL RESULT — INPUT TO YOU
      Here is the FHIR data bundle retrieved for the patient. Use this data to generate the summary.
      <<
      ${JSON.stringify(bundle, null, 2)}
      >>

      NOW BEGIN.
      Produce OUTPUT FORMAT (A) then (B).

      Finally, provide a narrative summary of the patient's clinical status based on the provided observations. This summary should be in prose and highlight any notable trends or abnormal results.
      Here are the formatted observations to use:
      ${formattedObservations}
    `;

    // Step 3: Call the generative model
    console.log('Calling generative model...');
    const result = await model.generateContent(prompt);
    const response = result.response;
    const summaryText = response.text();
    console.log('Generative model call successful.');

    // Step 4: Return the generated summary
    return NextResponse.json({ summary: summaryText });

  } catch (error) {
    console.error('Error generating comprehensive summary:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Failed to generate summary', details: errorMessage }, { status: 500 });
  }
}
