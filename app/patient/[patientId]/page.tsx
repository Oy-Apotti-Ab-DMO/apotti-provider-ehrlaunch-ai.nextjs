// app/patient/[patientId]/page.tsx
"use client"; 

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import axios from "axios";
import { useOAuth } from "../../context/OAuthContext"; // Import the custom hook
import '../../styles/PatientPage.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Patient {
  id: string;
  name?: { text: string }[];
  birthDate?: string;
  address?: { text: string }[];
}

interface ObservationEntry {
  resource: {
    code?: { text: string };
    category?: Array<{
      coding: Array<{
        system: string;
        code: string;
        display: string;
      }>;
    }>;
    valueQuantity?: { value: number; unit: string };
    effectiveDateTime?: string;
  };
}

function PatientPageContent() {
  const { patientId } = useParams();
  const searchParams = useSearchParams();
  const accessToken = searchParams.get('accessToken');

  const [patientData, setPatientData] = useState<Patient | null>(null);
  const { authorizeUrl } = useOAuth(); // Use the context to get only the authorizeUrl

  // State for the new comprehensive summary
  const [summaryBundle, setSummaryBundle] = useState<any>(null);
  const [isBundleLoading, setIsBundleLoading] = useState<boolean>(false);
  const [bundleError, setBundleError] = useState<string>('');

  useEffect(() => {
    const initiateAuthorization = () => {
      if (authorizeUrl) {
        const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
        const redirectUri = window.location.origin + '/api/auth/callback';
        const authUrl = `${authorizeUrl}?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}`;

        window.location.href = authUrl;
      }
    };

    if (!accessToken && authorizeUrl) {
      initiateAuthorization();
    }
  }, [accessToken, authorizeUrl]);

  useEffect(() => {
    if (patientId && accessToken) {
      const fetchPatientData = async () => {
        try {
          const response = await axios.get(`/api/patient/${patientId}`, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });
          setPatientData(response.data);
        } catch (error) {
          console.error('Error fetching patient data:', error);
        }
      };

      const fetchComprehensiveSummary = async () => {
        setIsBundleLoading(true);
        setBundleError('');
        try {
          const response = await axios.get(`/api/generate-comprehensive-summary?patientId=${patientId}`, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });
          setSummaryBundle(response.data);
        } catch (error) {
          console.error('Error fetching comprehensive summary:', error);
          setBundleError('Failed to fetch comprehensive summary.');
        } finally {
          setIsBundleLoading(false);
        }
      };

      fetchPatientData();
      fetchComprehensiveSummary();
    }
  }, [patientId, accessToken]);

  if (!patientData) return <div>Loading...</div>;

  return (
    <div className="container">
      <div className="header">
        <h1>Patient Info</h1>
      </div>
      {patientData && (
        <div className="patient-info">
          <table>
            <tbody>
              <tr>
                <td><strong>Name:</strong></td>
                <td>{patientData.name?.[0]?.text || 'N/A'}</td>
              </tr>
              <tr>
                <td><strong>ID:</strong></td>
                <td>{patientData.id}</td>
              </tr>
              <tr>
                <td><strong>Date of Birth:</strong></td>
                <td>{patientData.birthDate || 'N/A'}</td>
              </tr>
              <tr>
                <td><strong>Address:</strong></td>
                <td>{patientData.address?.[0]?.text || 'N/A'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Section for the new comprehensive summary bundle */}
      <div className="header">
        <h1>AI-Generated Summary</h1>
      </div>
      {isBundleLoading && <p>Loading comprehensive data...</p>}
      {bundleError && <p style={{ color: 'red' }}>{bundleError}</p>}
      {summaryBundle && !isBundleLoading && (
        <div className="ai-summary">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {summaryBundle.summary.replace(/```json[\s\S]*?```/, '')}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}



export default function PatientPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PatientPageContent />
    </Suspense>
  );
}