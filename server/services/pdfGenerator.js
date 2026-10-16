const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generates a PDF Quote
 * @param {Object} caseData - The case object containing client and quote info
 * @returns {Promise<Buffer>} - The PDF buffer
 */
function generateQuotePDF(caseData) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            const buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });

            // Header
            doc.fontSize(20).text('HVAC Assistant Service Quote', { align: 'center' });
            doc.moveDown();
            doc.fontSize(12).text(`Date: ${new Date().toLocaleDateString()}`, { align: 'right' });
            doc.moveDown();

            // Client Info
            doc.fontSize(14).text('Client Information', { underline: true });
            const clientName = caseData.analysis?.client_name || caseData.clientData?.name || 'Valued Client';
            const contactNumber = caseData.analysis?.contact_number || caseData.clientData?.contact || 'N/A';
            const fullAddress = caseData.full_address || `Zip Code: ${caseData.analysis?.service_zip_code || 'N/A'}`;
            
            doc.fontSize(12).text(`Name: ${clientName}`);
            doc.text(`Phone: ${contactNumber}`);
            doc.text(`Address: ${fullAddress}`);
            doc.moveDown();

            // Issue Summary
            doc.fontSize(14).text('Issue Summary', { underline: true });
            doc.fontSize(12).text(`${caseData.analysis?.problem_summary || 'N/A'}`);
            doc.moveDown();

            // Quote Details
            doc.fontSize(14).text('Service Quotation', { underline: true });
            doc.moveDown();

            const quoteText = caseData.final_quote || "Pending Quote Generation";

            // Simple parsing of markdown table to text for PDF (Basic implementation)
            // Ideally, we'd parse the markdown properly, but for text-based PDF:
            doc.font('Courier').fontSize(10).text(quoteText, {
                width: 500,
                align: 'left'
            });

            doc.moveDown(2);
            doc.font('Helvetica-Bold').fontSize(12).text('Terms & Conditions:', { underline: true });
            doc.font('Helvetica').fontSize(10).text('1. This is a preliminary estimate subject to on-site inspection.');
            doc.text('2. Valid for 7 days from the date of issue.');

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

module.exports = { generateQuotePDF };
