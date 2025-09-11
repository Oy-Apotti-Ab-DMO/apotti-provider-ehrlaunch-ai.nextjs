import axios from 'axios';

interface Resource {
  [key: string]: unknown;
  resourceType: string;
}

interface Bundle {
  resourceType: 'Bundle';
  type: string;
  entry: {
    resource: Resource;
  }[];
}

const fhirServerUrl = process.env.NEXT_PUBLIC_FHIR_SERVER;

/**
 * Performs a FHIR search operation for a given resource type.
 * 
 * @param resourceType The type of FHIR resource to search for (e.g., 'Patient', 'Observation').
 * @param accessToken The OAuth2 access token for authentication.
 * @param params The search parameters for the FHIR query.
 * @returns A FHIR Bundle containing the search results.
 */
export async function fhirSearch(resourceType: string, accessToken: string, params: Record<string, string | number | boolean>) {
  if (!accessToken) {
    throw new Error('Access Token is required');
  }

  try {
    const response = await axios.get(`${fhirServerUrl}/${resourceType}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/fhir+json',
        },
        params,
      }
    );
    return response.data;
  } catch (error) {
    console.error(`Error fetching FHIR resource ${resourceType} with params ${JSON.stringify(params)}:`, error);
    if (axios.isAxiosError(error)) {
      throw new Error(`FHIR API Error: ${error.response?.status} ${JSON.stringify(error.response?.data)}`);
    }
    throw new Error('Failed to fetch FHIR data');
  }
}

/**
 * Reads a specific FHIR resource by its ID.
 *
 * @param resourceType The type of FHIR resource to read.
 * @param id The ID of the resource.
 * @param accessToken The OAuth2 access token.
 * @returns The requested FHIR resource.
 */
export async function fhirRead(resourceType: string, id: string, accessToken: string) {
  if (!accessToken) {
    throw new Error('Access Token is required');
  }

  try {
    const response = await axios.get(`${fhirServerUrl}/${resourceType}/${id}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/fhir+json',
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error(`Error fetching FHIR resource ${resourceType}/${id}:`, error);
    if (axios.isAxiosError(error)) {
      throw new Error(`FHIR API Error: ${error.response?.status} ${JSON.stringify(error.response?.data)}`);
    }
    throw new Error('Failed to read FHIR data');
  }
}

/**
 * Implements the patient_everything logic by fetching a list of specified resource types for a patient.
 *
 * @param patientId The ID of the patient.
 * @param accessToken The OAuth2 access token.
 * @returns A combined FHIR Bundle containing all the fetched resources.
 */
export async function patientEverything(patientId: string, accessToken: string): Promise<Bundle> {
  const resourceTypes = [
    "AllergyIntolerance", "CarePlan", "CareTeam", "Condition", "DiagnosticReport",
    "Encounter", "Goal", "Immunization", "MedicationDispense", "MedicationRequest",
    "Observation", "Procedure", "ServiceRequest", "ProcedureRequest"
  ];

  const promises = resourceTypes.map(type => 
    fhirSearch(type, accessToken, { patient: patientId, _sort: '-date' }) // Sorting by date descending where applicable
  );

  const results = await Promise.allSettled(promises);

  const combinedBundle: Bundle = {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [],
  };

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      if (result.value.entry) {
        combinedBundle.entry.push(...result.value.entry);
      }
    } else {
      // Log the error but don't stop the entire process
      console.error(`Failed to fetch ${resourceTypes[index]}:`, result.reason);
    }
  });

  return combinedBundle;
}
