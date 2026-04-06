// Runs in MAIN world — can access PDFViewerApplication
window.addEventListener('message', async e => {
    if (e.data?.type !== 'WC_GET_PDF_DATA') return;
    try {
        const app = PDFViewerApplication;
        if (!app || !app.pdfDocument) {
            window.postMessage({ type: 'WC_PDF_DATA', error: 'PDFViewerApplication not ready' }, '*');
            return;
        }
        // saveDocument() returns the document with any modifications applied.
        // For encrypted PDFs opened with a password, some PDF.js builds strip the
        // encryption in the saved output. Fall back to getData() otherwise.
        let bytes;
        try {
            bytes = await app.pdfDocument.saveDocument();
        } catch (_) {
            bytes = await app.pdfDocument.getData();
        }
        window.postMessage({ type: 'WC_PDF_DATA', bytes: Array.from(bytes) }, '*');
    } catch (err) {
        window.postMessage({ type: 'WC_PDF_DATA', error: String(err) }, '*');
    }
});
