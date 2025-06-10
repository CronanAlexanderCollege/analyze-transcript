
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import {GoogleGenAI, GenerateContentResponse} from '@google/genai';
import {useEffect, useState, ChangeEvent, useCallback} from 'react';
import ReactDOM from 'react-dom/client';
import { getDocument, GlobalWorkerOptions, PDFDocumentProxy, PDFPageProxy, TextItem } from 'pdfjs-main';

// Configure PDF.js worker source directly using a CDN link.
GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

// Initialize the GoogleGenAI client instance.
// Ensure API_KEY is available in the environment.
let ai: GoogleGenAI | null = null;
try {
  ai = new GoogleGenAI({apiKey: process.env.API_KEY});
} catch (err) {
  console.error("Failed to initialize GoogleGenAI:", err);
  // The UI will show an error message if `ai` remains null and API calls are attempted.
}

interface TransferAgreement {
  Id: number;
  SndrInstitutionName: string;
  SndrSubjectCode: string;
  SndrCourseNumber: string;
  SndrCourseTitle: string;
  SndrCourseCredit: number;
  RcvrInstitutionName: string;
  Detail: string; // e.g., "AU ENGL 2XX (3)"
  Condition?: string | null;
  // Add other fields if needed for display, but keep it concise
}

interface PassedCourse {
  subject: string;
  number: string;
}

function App() {
  const [greetingMessage, setGreetingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const [pdfProcessingStatus, setPdfProcessingStatus] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [summaryStatus, setSummaryStatus] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState<boolean>(false);
  const [transcriptValidityMessage, setTranscriptValidityMessage] = useState<string | null>(null);

  const [transferData, setTransferData] = useState<TransferAgreement[] | null>(null);
  const [transferDataLoading, setTransferDataLoading] = useState<boolean>(true);
  const [transferDataError, setTransferDataError] = useState<string | null>(null);
  const [matchedAgreements, setMatchedAgreements] = useState<TransferAgreement[] | null>(null);


  useEffect(() => {
    const initializeApp = async () => {
      if (!ai) {
        setGreetingMessage("Oops! I couldn't connect. Please check your setup.");
        setError("Failed to initialize AI. API key might be missing or invalid.");
        return;
      }
      try {
        const responseStream = await ai.models.generateContentStream({
          model: 'gemini-2.5-flash-preview-04-17',
          contents: 'Briefly! Greet the user and advise that an uploaded transcript will be summarized.',
        });

        let greeting = '';
        for await (const chunk of responseStream) {
          greeting += chunk.text;
        }
        setGreetingMessage(greeting);
      } catch (err) {
        console.error("Failed to generate greeting:", err);
        setGreetingMessage("Oops! I couldn't connect. Please check your setup.");
        setError("Failed to load initial greeting. API key or network issue?");
      }
    };

    initializeApp();

    // Fetch transfer data
    const fetchTransferData = async () => {
      setTransferDataLoading(true);
      setTransferDataError(null);
      try {
        const response = await fetch('./AC_Transfer_DataFull-Extended.json');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data: TransferAgreement[] = await response.json();
        setTransferData(data);
      } catch (err) {
        console.error('Failed to load transfer agreements:', err);
        setTransferDataError('Failed to load transfer agreements. Some features may be unavailable.');
        setTransferData(null);
      } finally {
        setTransferDataLoading(false);
      }
    };
    fetchTransferData();

  }, []);

  const resetPdfStates = () => {
    setPdfData(null);
    setFileStatus(null);
    setPdfProcessingStatus(null);
    setExtractedText(null);
    setSummaryText(null);
    setSummaryStatus(null);
    setIsSummarizing(false);
    setTranscriptValidityMessage(null);
    setMatchedAgreements(null); // Reset matched agreements
  };

  const extractTextFromPdf = async (data: ArrayBuffer) => {
    setPdfProcessingStatus('Extracting text from PDF...');
    setExtractedText(null);
    setSummaryText(null);
    setSummaryStatus(null);
    setTranscriptValidityMessage(null);
    setMatchedAgreements(null);

    try {
      const loadingTask = getDocument({ data });
      const pdf: PDFDocumentProxy = await loadingTask.promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page: PDFPageProxy = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.filter(item => 'str' in item).map(item => (item as TextItem).str).join(' ');
        fullText += pageText + '\n';
      }

      const trimmedText = fullText.trim();
      if (trimmedText) {
        setExtractedText(trimmedText);
        if (!trimmedText.toLowerCase().includes('transcript')) {
          setTranscriptValidityMessage('Warning: The uploaded document does not appear to be a transcript.');
        } else {
          setTranscriptValidityMessage(null);
        }
        setPdfProcessingStatus(null);
      } else {
        setExtractedText(null);
        setPdfProcessingStatus('No text could be extracted from the PDF.');
        setTranscriptValidityMessage(null);
      }
    } catch (err) {
      console.error('Error extracting text from PDF:', err);
      setError('Failed to extract text from the PDF. The file might be corrupted or password-protected.');
      setPdfProcessingStatus('Error extracting text.');
      setExtractedText(null);
      setTranscriptValidityMessage(null);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setError(null);
    resetPdfStates();

    if (file) {
      if (file.type !== "application/pdf") {
        setError('Invalid file type. Please upload a PDF file.');
        if (event.target) event.target.value = '';
        return;
      }

      setFileStatus(`Loading file: ${file.name}...`);
      const reader = new FileReader();

      reader.onload = async (e) => {
        if (e.target?.result instanceof ArrayBuffer) {
          setPdfData(e.target.result);
          setFileStatus(`File '${file.name}' loaded successfully.`);
          await extractTextFromPdf(e.target.result);
        } else {
          setError('Error reading file: Could not get ArrayBuffer.');
          setFileStatus('Error loading file.');
          if (event.target) event.target.value = '';
        }
      };

      reader.onerror = () => {
        setError('Error reading file.');
        setFileStatus('Error loading file.');
        if (event.target) event.target.value = '';
      };

      reader.readAsArrayBuffer(file);
    }
  };

  const handleSummarize = useCallback(async () => {
    if (!extractedText || isSummarizing || !ai) {
      if (!ai && !error) setError("AI client not initialized. Cannot summarize.");
      return;
    }

    setIsSummarizing(true);
    setSummaryStatus('Generating summary...');
    setSummaryText(null);
    setError(null);
    setMatchedAgreements(null);

    try {
      const prompt = `First, provide a bullet-point list of all course codes and their corresponding grades (e.g., - MATH 101: A+).
IMPORTANT: If a student has attempted a course multiple times, please only list the attempt that resulted in a passing grade. If multiple attempts were passing, list the one with the highest grade. If no attempt resulted in a passing grade, you may list the latest attempt or indicate that all attempts were unsuccessful for that course.
CRITICAL: Do NOT include any course in this list if the awarded grade is 'W' (for withdrawal).

Following the list, please provide a concise general summary of the following academic transcript. Highlight key aspects such as overall performance, number of terms/years attended, CGPA, and any notable trends or repeated courses.

Transcript:\n\n${extractedText}`;
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-04-17',
        contents: prompt,
      });
      setSummaryText(response.text);
      setSummaryStatus('Summary complete!');
    } catch (err) {
      console.error('Error generating summary:', err);
      setError('Failed to generate summary. Please try again.');
      setSummaryStatus('Error generating summary.');
      setSummaryText(null);
    } finally {
      setIsSummarizing(false);
    }
  }, [ai, extractedText, isSummarizing, error, setError, setIsSummarizing, setSummaryStatus, setSummaryText]);

  const parsePassedCoursesFromSummary = (summary: string): PassedCourse[] => {
    const courses: PassedCourse[] = [];
    // Regex to capture: Subject Code (e.g., ENGL, MATH), Course Number (e.g., 100, 101A), Grade (e.g., A+, B, P, 75%)
    // Allows for 2-6 letters (case-insensitive) for subject, and 3-5 alphanumeric (case-insensitive for letters) for course number.
    // Updated to match lines starting with optional whitespace then '*' or '-'
    const courseRegex = /^\s*[*-]\s*([A-Za-z]{2,6})\s*([A-Za-z0-9]{3,5})\s*:\s*([A-Z][+-]?|[B-DFP][+-]?|[0-9]{1,3}%?)/gm;
    let match;
    while ((match = courseRegex.exec(summary)) !== null) {
        // The prompt already instructs the AI to filter out 'W' grades and handle multiple attempts.
        // This regex focuses on capturing the course code and number from successfully listed items.
        courses.push({ subject: match[1].trim(), number: match[2].trim() });
    }
    return courses;
  };

  const findAndDisplayTransferMatches = useCallback(() => {
    if (!summaryText || !transferData) {
      setMatchedAgreements(null);
      return;
    }

    const passedCourses = parsePassedCoursesFromSummary(summaryText);
    if (passedCourses.length === 0) {
      setMatchedAgreements([]); // No courses to match
      return;
    }

    const matches: TransferAgreement[] = [];
    passedCourses.forEach(passedCourse => {
      transferData.forEach(agreement => {
        // Trim whitespace from JSON fields for robust matching
        if (agreement.SndrSubjectCode && agreement.SndrCourseNumber &&
            agreement.SndrSubjectCode.trim().toUpperCase() === passedCourse.subject.toUpperCase() &&
            agreement.SndrCourseNumber.trim().toUpperCase() === passedCourse.number.toUpperCase()) {
          matches.push(agreement);
        }
      });
    });
    setMatchedAgreements(matches);
  }, [summaryText, transferData]);


  useEffect(() => {
    if (extractedText && transcriptValidityMessage === null && !isSummarizing && !summaryText && ai) {
      handleSummarize();
    }
  }, [extractedText, transcriptValidityMessage, isSummarizing, summaryText, ai, handleSummarize]);

  useEffect(() => {
    if (summaryText && transferData && !transferDataLoading && !transferDataError) {
      findAndDisplayTransferMatches();
    }
     // Explicitly set matchedAgreements to null if conditions aren't met (e.g., new summary is loading)
     // This ensures the old matches are cleared when a new summary process starts or if transfer data is not ready.
    else if (!summaryText || transferDataLoading || transferDataError) {
        setMatchedAgreements(null);
    }
  }, [summaryText, transferData, transferDataLoading, transferDataError, findAndDisplayTransferMatches]);


  return (
    <div className="container">
      <h1>{greetingMessage || 'Loading greeting...'}</h1>
      {error && <p className="error-message">{error}</p>}

      <div className="upload-section">
        <h2>Upload your transcript (PDF only):</h2>
        <input
          type="file"
          id="transcriptFile"
          name="transcriptFile"
          accept=".pdf"
          aria-label="Upload transcript PDF"
          onChange={handleFileChange}
        />
        {fileStatus && <p className="file-status-message">{fileStatus}</p>}
        {pdfProcessingStatus && <p className="pdf-processing-status">{pdfProcessingStatus}</p>}
      </div>

      {extractedText && (
        <div className="extracted-text-section">
          <h2>Extracted Text:</h2>
          {transcriptValidityMessage && <p className="transcript-validity-message">{transcriptValidityMessage}</p>}
          <div className="extracted-text-container">
            <pre>{extractedText}</pre>
          </div>
        </div>
      )}

      {summaryStatus && (
          <p className={`summary-status-message ${summaryText && !isSummarizing ? 'success' : 'info'}`} aria-live="polite">
            {summaryStatus}
          </p>
      )}
      {isSummarizing && !summaryStatus && <p className="summary-status-message info" aria-live="polite">Generating summary...</p>}


      {summaryText && !isSummarizing && (
        <div className="summary-section">
          <h2>Transcript Summary:</h2>
          <div className="summary-text-container">
            {summaryText}
          </div>
        </div>
      )}

      {/* Transfer Agreements Section */}
      {summaryText && !isSummarizing && ( 
        <div className="transfer-agreements-section">
          <h2>Potential Transfer Agreements:</h2>
          <div className="transfer-agreements-content-container">
            {transferDataLoading && <p className="status-message info">Loading transfer agreements...</p>}
            {transferDataError && <p className="status-message error">{transferDataError}</p>}
            {!transferDataLoading && !transferDataError && transferData && matchedAgreements === null && (
              <p className="status-message info">Processing transfer matches...</p>
            )}
            {!transferDataLoading && !transferDataError && transferData && matchedAgreements && matchedAgreements.length > 0 && (
              matchedAgreements.map((agreement, index) => (
                <div key={agreement.Id + '-' + index} className="transfer-agreement-item">
                  <p>
                    <strong>Your course:</strong> {agreement.SndrInstitutionName} - {agreement.SndrSubjectCode} {agreement.SndrCourseNumber}: {agreement.SndrCourseTitle} ({agreement.SndrCourseCredit} credits)
                  </p>
                  <p>
                    <strong>Transfers to:</strong> {agreement.RcvrInstitutionName} as {agreement.Detail}
                  </p>
                  {agreement.Condition && <p><strong>Condition:</strong> {agreement.Condition}</p>}
                </div>
              ))
            )}
            {!transferDataLoading && !transferDataError && transferData && matchedAgreements && matchedAgreements.length === 0 && (
              <p className="status-message">No potential transfer agreements found for the summarized courses.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);
