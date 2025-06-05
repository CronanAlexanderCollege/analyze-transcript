/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import {GoogleGenAI, GenerateContentResponse} from '@google/genai';
import {useEffect, useState, ChangeEvent} from 'react';
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
          contents: 'Display a simple greeting stating you are here to help',
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
  };

  const extractTextFromPdf = async (data: ArrayBuffer) => {
    setPdfProcessingStatus('Extracting text from PDF...');
    setExtractedText(null);
    setSummaryText(null); // Clear previous summary
    setSummaryStatus(null);
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
      setExtractedText(fullText.trim());
      setPdfProcessingStatus('Text extracted successfully!');
    } catch (err) {
      console.error('Error extracting text from PDF:', err);
      setError('Failed to extract text from the PDF. The file might be corrupted or password-protected.');
      setPdfProcessingStatus('Error extracting text.');
      setExtractedText(null);
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

  const handleSummarize = async () => {
    if (!extractedText || isSummarizing || !ai) {
      if (!ai) setError("AI client not initialized. Cannot summarize.");
      return;
    }

    setIsSummarizing(true);
    setSummaryStatus('Generating summary...');
    setSummaryText(null);
    setError(null); // Clear previous errors

    try {
      const prompt = `Please provide a concise summary of the following academic transcript. Highlight key aspects such as overall performance, number of terms/years attended, CGPA, and any notable trends or repeated courses. Transcript:\n\n${extractedText}`;
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
  };

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
          <div className="extracted-text-container">
            <pre>{extractedText}</pre>
          </div>
          <button
            onClick={handleSummarize}
            disabled={isSummarizing || !extractedText}
            className="summarize-button"
          >
            {isSummarizing ? 'Summarizing...' : 'Summarize Transcript'}
          </button>
        </div>
      )}

      {summaryStatus && (
          <p className={`summary-status-message ${summaryText ? 'success' : 'info'}`}>
            {summaryStatus}
          </p>
      )}

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