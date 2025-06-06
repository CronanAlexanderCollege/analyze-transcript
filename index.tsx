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
  };

  const extractTextFromPdf = async (data: ArrayBuffer) => {
    setPdfProcessingStatus('Extracting text from PDF...');
    setExtractedText(null);
    setSummaryText(null); // Clear previous summary
    setSummaryStatus(null);
    setTranscriptValidityMessage(null); // Reset validity message

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
          setTranscriptValidityMessage(null); // Explicitly null if it's a transcript
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
    setError(null); // Clear general errors
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
      // Do not proceed if extractedText is null or already summarizing.
      // Error for !ai is set if not already set by initializeApp
      return;
    }

    setIsSummarizing(true);
    setSummaryStatus('Generating summary...');
    setSummaryText(null);
    setError(null); // Clear previous errors

    try {
      const prompt = `First, provide a bullet-point list of all course codes and their corresponding grades (e.g., - MATH 101: A+). If a student has attempted a course multiple times, please only list the attempt that resulted in a passing grade. If the awarded grade ='W' do not include. If multiple attempts were passing, list the one with the highest grade. If no attempt resulted in a passing grade, you may list the latest attempt or indicate that all attempts were unsuccessful for that course.

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


  useEffect(() => {
    // Auto-summarize if text is extracted, it's considered a valid transcript,
    // not currently summarizing, and no summary exists yet for this text.
    if (extractedText && transcriptValidityMessage === null && !isSummarizing && !summaryText && ai) {
      handleSummarize();
    }
  }, [extractedText, transcriptValidityMessage, isSummarizing, summaryText, ai, handleSummarize]);


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
          {/* Summarize button removed for automatic summarization */}
        </div>
      )}

      {summaryStatus && (
          <p className={`summary-status-message ${summaryText ? 'success' : 'info'}`} aria-live="polite">
            {summaryStatus}
          </p>
      )}
      {isSummarizing && !summaryStatus && <p className="summary-status-message info" aria-live="polite">Generating summary...</p>}


      {summaryText && (
        <div className="summary-section">
          <h2>Transcript Summary:</h2>
          <div className="summary-text-container">
            {summaryText}
          </div>
        </div>
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);