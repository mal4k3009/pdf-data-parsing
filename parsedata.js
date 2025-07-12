const rawText = $json.text;
const lines = rawText.split('\n');
const startIndex = lines.findIndex(line => /^TWW\s+/.test(line));
const workingLines = lines.slice(startIndex).filter(line => line.trim() !== '');
const itemBlocks = [];
let currentBlock = [];

for (let line of workingLines) {
  line = line.trim();
  // Stop processing if we hit the summary section
  if (line.includes('TOTAL') || line.includes('TAXABLE AMT') || line.includes('For JUMAX FOAM')) {
    break;
  }
  
  if (/^TWW\s+/.test(line)) {
    if (currentBlock.length) itemBlocks.push(currentBlock);
    currentBlock = [line];
  } else {
    currentBlock.push(line);
  }
}
if (currentBlock.length) itemBlocks.push(currentBlock);

// Utility to clean description
function cleanDescription(desc) {
  const cutMarkers = [
    "JUMAX", "BULANDSHAHAR", "GAUTAM", "REGD", "BANK", "ACCOUNT", "Invoice", 
    "SN DESCRIP", "IFSC", "UBIN", "ONLY", "P.O.No", "DATED", "Vehicle",
    "GST INVOICE", "GSTINVOICE", "Original For Buyer", "FOAM PVT LIMITED",
    "GSTIN", "09AAACJ0130B1ZF", "CONTD.ON NEXT PAGE", "CONTD ON NEXT PAGE",
    "TWW-HPCN94042190", "92671"
  ];
  
  for (const marker of cutMarkers) {
    const i = desc.indexOf(marker);
    if (i !== -1) {
      desc = desc.substring(0, i);
    }
  }
  
  // Remove any remaining unwanted patterns
  desc = desc.replace(/\b\d{5,}\b/g, ''); // Remove long numbers
  desc = desc.replace(/CONTD\.?ON NEXT PAGE/gi, '');
  desc = desc.replace(/TWW-HPCN\d+/g, '');
  
  // Remove invoice line continuation patterns - these are the main culprits
  // Pattern 1: "9.00 TWW-HPCN1" - remove this specific pattern
  desc = desc.replace(/\s+[\d\.]+\s+TWW-HPCN\d+/gi, '');
  
  // Pattern 2: "TWW-HPCN1 7.00 PCS 225.00 1575.00 9.00OSMALL" - remove entire pattern
  desc = desc.replace(/TWW-HPCN\d+\s+[\d\.]+\s+PCS\s+[\d\.]+\s+[\d\.]+\s+[\d\.]+[A-Z\s]*/gi, '');
  
  // Pattern 3: "7.00 PCS 225.00 1575.00 9.00" anywhere in text
  desc = desc.replace(/\s*[\d\.]+\s+PCS\s+[\d\.]+\s+[\d\.]+\s+[\d\.]+[A-Z\s]*/gi, '');
  
  // Pattern 4: "2.00 PCS 255.00 510.00 9.00X SMALL G" - more specific
  desc = desc.replace(/\s*[\d\.]+\s+PCS\s+[\d\.]+\s+[\d\.]+\s+[\d\.]+[A-Z\s]*[A-Z]/gi, '');
  
  // Pattern 5: Remove standalone numeric patterns that look like "9.00 TWW-HPCN1 2.00 PCS 255.00 510.00 9.00X SMA"
  desc = desc.replace(/\s*[\d\.]+\s+TWW-HPCN\d+\s+[\d\.]+\s+PCS\s+[\d\.]+\s+[\d\.]+\s+[\d\.]+[A-Z\s]*/gi, '');
  
  return desc.replace(/\s+/g, ' ').trim();
}

const parsed = itemBlocks.map((block, idx) => {
  try {
    if (block.length < 3) {
      console.warn(`Insufficient data in block ${idx + 1}`);
      return null;
    }
    
    // Parse the first line: TWW HSN PKG QTY UNIT RATE
    const firstLine = block[0].trim();
    const firstMatch = firstLine.match(/^TWW(-HPCN)?\s+(\d{8})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\w+)\s+(\d+(?:\.\d+)?)$/);
    
    if (!firstMatch) {
      console.warn(`Failed to parse first line: ${firstLine}`);
      return null;
    }
    
    const [_, hpcnSuffix, hsn, pkg, qty, unit, rate] = firstMatch;
    
    // Second line should be serial number (skip it, we'll use index)
    const serialLine = block[1] ? block[1].trim() : '';
    
    // Third line contains: AMOUNT CGST+DESCRIPTION
    const thirdLine = block[2] ? block[2].trim() : '';
    const thirdMatch = thirdLine.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(.*)$/);
    
    if (!thirdMatch) {
      console.warn(`Failed to parse third line: ${thirdLine}`);
      return null;
    }
    
    const amount = thirdMatch[1];
    let cgst = thirdMatch[2];
    let descriptionPart = thirdMatch[3];
    
    // Collect remaining description parts but filter out unwanted content
    const remainingLines = block.slice(3).filter(line => {
      const trimmedLine = line.trim();
      return trimmedLine !== '' && 
             !trimmedLine.includes('CONTD') && 
             !trimmedLine.includes('NEXT PAGE') &&
             !trimmedLine.match(/^\d+$/); // Skip lines that are just numbers
    });
    
    // Join description parts with single space, then clean up
    let fullDescription = (descriptionPart + ' ' + remainingLines.join(' ')).trim();
    
    // Clean out any remaining unwanted content
    fullDescription = fullDescription.replace(/CONTD\.?ON NEXT PAGE/gi, '').trim();
    fullDescription = fullDescription.replace(/TWW-HPCN\d+/g, '').trim();
    
    // Extract SGST - it should be the last numeric token BEFORE cleaning invoice patterns
    const tokens = fullDescription.split(/\s+/).filter(token => token.length > 0);
    let sgst = '0';
    
    // Look for SGST as the last numeric token before any invoice continuation patterns
    if (tokens.length > 0) {
      // Find the last pure numeric token that's not part of an invoice pattern
      for (let i = tokens.length - 1; i >= 0; i--) {
        const token = tokens[i];
        if (/^\d+(?:\.\d+)?$/.test(token)) {
          // Check if this token is part of an invoice continuation pattern
          const contextStart = Math.max(0, i - 6);
          const contextTokens = tokens.slice(contextStart, i + 1);
          const contextStr = contextTokens.join(' ');
          
          // If it's not part of "X.XX PCS XXX.XX XXXX.XX X.XX" pattern or "X.XX TWW-HPCN" pattern, use it as SGST
          if (!contextStr.match(/[\d\.]+\s+PCS\s+[\d\.]+\s+[\d\.]+\s+[\d\.]+$/) && 
              !contextStr.match(/[\d\.]+\s+TWW-HPCN\d+$/)) {
            sgst = token;
            // Remove this token from the description
            tokens.splice(i, 1);
            fullDescription = tokens.join(' ');
            break;
          }
        }
      }
    }
    
    // If no SGST found, default to CGST
    if (sgst === '0') {
      sgst = cgst;
    }
    
    // Clean up description AFTER extracting SGST
    fullDescription = fullDescription.replace(/^\s*/, '').replace(/\s*$/, '');
    
    // Add TWW prefix and clean description
    let description = 'TWW ' + cleanDescription(fullDescription);
    
    // More aggressive space cleanup
    description = description.replace(/\s+/g, ' ').trim();
    
    // Fix specific spacing issues:
    description = description.replace(/\s*-\s*/g, '-');
    description = description.replace(/(\d+)\s+([A-Z])$/g, '$1$2');
    description = description.replace(/(\d+)\s+([A-Z])(?=\s|$)/g, '$1$2');
    description = description.replace(/\b([A-Z])\s+([A-Z]{2,})\b/g, '$1$2');
    description = description.replace(/-(\w+)\s+(\w+)/g, '-$1$2');
    description = description.replace(/\s+([A-Z0-9]+)$/g, '$1');
    
    // Final cleanup to remove any remaining invoice continuation patterns
    description = description.replace(/\s+[\d\.]+\s+PCS\s+[\d\.]+\s+[\d\.]+\s+[\d\.]+[A-Z\s]*$/gi, '');
    description = description.replace(/\s+[\d\.]+\s+TWW-HPCN\d+.*$/gi, '');
    
    // Only remove trailing "9.00" specifically (which is the SGST/CGST rate that shouldn't be in description)
    // Don't remove other numbers that might be part of product names
    description = description.replace(/\s+9\.00$/gi, '');
    
    // Ensure clean ending
    description = description.replace(/\s+$/, '').trim();
    
    // Validation
    const parsedAmount = parseFloat(amount);
    const parsedRate = parseFloat(rate);
    const parsedQty = parseFloat(qty);
    const expectedAmount = parsedRate * parsedQty;
    
    if (Math.abs(parsedAmount - expectedAmount) > 0.01) {
      console.warn(`Amount validation failed for item ${idx + 1}. Expected: ${expectedAmount}, Got: ${parsedAmount}`);
    }
    
    return {
      sl_no: idx + 1,
      hsn: hsn,
      pkg: parseFloat(pkg),
      qty: parseFloat(qty),
      unit: unit,
      rate: parseFloat(rate),
      amount: parseFloat(amount),
      cgst: parseFloat(cgst),
      sgst: parseFloat(sgst),
      description: description
    };
    
  } catch (error) {
    console.error(`Error parsing item ${idx + 1}:`, error);
    console.error(`Block data:`, block);
    return null;
  }
}).filter(Boolean);

if (parsed.length === 0) {
  return [{ json: { error: "Parsing failed", raw: itemBlocks.slice(0, 3), debug: "Check console for detailed errors" } }];
}

return parsed.map(row => ({ json: row }));
