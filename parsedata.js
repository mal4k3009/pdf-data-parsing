const rawText = $json.text;
const lines = rawText.split('\n');
const startIndex = lines.findIndex(line => /^TWW\s+/.test(line));
const workingLines = lines.slice(startIndex).filter(line => line.trim() !== '');
const itemBlocks = [];
let currentBlock = [];

// Enhanced logging
console.log(`Total lines after filtering: ${workingLines.length}`);

for (let line of workingLines) {
  line = line.trim();
  // Stop processing if we hit the summary section
  if (line.includes('TOTAL') || line.includes('TAXABLE AMT') || line.includes('For JUMAX FOAM') || 
      line.includes('CONTD.ON NEXT PAGE') || line.includes('Auth. Signatory') || 
      line.includes('GOODS DISPATCHED')) {
    console.log(`Stopping at line: ${line}`);
    break;
  }
  
  if (/^TWW(\s|-HPCN|\s+-HPCN)/.test(line)) {
    if (currentBlock.length) itemBlocks.push(currentBlock);
    currentBlock = [line];
  } else if (currentBlock.length > 0) {
    // Only add non-empty lines to current block
    if (line.length > 0) {
      currentBlock.push(line);
    }
  }
}
if (currentBlock.length) itemBlocks.push(currentBlock);

console.log(`Total item blocks found: ${itemBlocks.length}`);

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

const parsed = [];
let successCount = 0;
let failureCount = 0;

itemBlocks.forEach((block, idx) => {
  try {
    if (block.length < 3) {
      console.warn(`Block ${idx + 1}: Insufficient data (${block.length} lines) - Block content:`, block);
      failureCount++;
      return;
    }
    
    // Parse the first line: TWW HSN PKG QTY UNIT RATE
    const firstLine = block[0].trim();
    
    // Multiple regex patterns to handle all variations
    const patterns = [
      // Standard pattern: TWW 94042190 1 9.00 PCS 720.00
      /^TWW\s+(\d{8})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\w+)\s+(\d+(?:\.\d+)?)$/,
      // With HPCN: TWW-HPCN 94042190 1 1.00 PCS 210.00
      /^TWW-HPCN\s+(\d{8})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\w+)\s+(\d+(?:\.\d+)?)$/,
      // With numbers after HPCN: TWW-HPCN1 94042190 1 1.00 PCS 210.00
      /^TWW-HPCN\d+\s+(\d{8})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\w+)\s+(\d+(?:\.\d+)?)$/,
      // Space variations: TWW  94042190 1 1.00 PCS 210.00
      /^TWW\s+(\d{8})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\w+)\s+(\d+(?:\.\d+)?)$/,
      // Tab variations and extra spaces
      /^TWW[\s\t]+(\d{8})[\s\t]+(\d+(?:\.\d+)?)[\s\t]+(\d+(?:\.\d+)?)[\s\t]+(\w+)[\s\t]+(\d+(?:\.\d+)?)$/,
      // HPCN with tab variations
      /^TWW-HPCN[\s\t]+(\d{8})[\s\t]+(\d+(?:\.\d+)?)[\s\t]+(\d+(?:\.\d+)?)[\s\t]+(\w+)[\s\t]+(\d+(?:\.\d+)?)$/
    ];
    
    let matchFound = false;
    let hpcnSuffix = null;
    let hsn, pkg, qty, unit, rate;
    
    for (let i = 0; i < patterns.length; i++) {
      const match = firstLine.match(patterns[i]);
      if (match) {
        matchFound = true;
        if (i === 1 || i === 2 || i === 5) { // HPCN patterns
          hpcnSuffix = 'HPCN';
        }
        [, hsn, pkg, qty, unit, rate] = match;
        console.log(`Block ${idx + 1}: Matched pattern ${i + 1}`);
        break;
      }
    }
    
    if (!matchFound) {
      console.warn(`Block ${idx + 1}: Failed to parse first line with all patterns: "${firstLine}"`);
      console.warn(`Block ${idx + 1}: Full block content:`, block);
      failureCount++;
      return;
    }
    
    processParsedMatch(block, idx, hpcnSuffix, hsn, pkg, qty, unit, rate);
    
  } catch (error) {
    console.error(`Block ${idx + 1}: Unexpected error:`, error);
    console.error(`Block ${idx + 1}: Block data:`, block);
    failureCount++;
  }
});

function processParsedMatch(block, idx, hpcnSuffix, hsn, pkg, qty, unit, rate) {
  try {
    // Second line should be serial number (skip it, we'll use index)
    const serialLine = block[1] ? block[1].trim() : '';
    
    // Third line contains: AMOUNT CGST+DESCRIPTION
    const thirdLine = block[2] ? block[2].trim() : '';
    
    // Multiple patterns for third line parsing
    const thirdPatterns = [
      // Standard: 6480.00 9.00ADJ HE WP 24-22-12 9.00
      /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(.*)$/,
      // With extra spaces: 6480.00  9.00 ADJ HE WP 24-22-12 9.00
      /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(.*)$/,
      // Tab separated: 6480.00	9.00ADJ HE WP 24-22-12 9.00
      /^(\d+(?:\.\d+)?)[\s\t]+(\d+(?:\.\d+)?)(.*)$/
    ];
    
    let thirdMatch = null;
    for (let pattern of thirdPatterns) {
      thirdMatch = thirdLine.match(pattern);
      if (thirdMatch) break;
    }
    
    if (!thirdMatch) {
      console.warn(`Block ${idx + 1}: Failed to parse third line with all patterns: "${thirdLine}"`);
      
      // Try to extract just amount and cgst without description
      const simpleMatch = thirdLine.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/);
      if (simpleMatch) {
        console.log(`Block ${idx + 1}: Third line has no description part`);
        const amount = simpleMatch[1];
        const cgst = simpleMatch[2];
        processItem(block, idx, hpcnSuffix, hsn, pkg, qty, unit, rate, amount, cgst, '');
        return;
      }
      
      // Last resort - try to parse amount only
      const amountOnlyMatch = thirdLine.match(/^(\d+(?:\.\d+)?)/);
      if (amountOnlyMatch) {
        console.log(`Block ${idx + 1}: Only amount found in third line, defaulting CGST to 9.00`);
        const amount = amountOnlyMatch[1];
        processItem(block, idx, hpcnSuffix, hsn, pkg, qty, unit, rate, amount, '9.00', '');
        return;
      }
      
      console.warn(`Block ${idx + 1}: Complete failure parsing third line`);
      failureCount++;
      return;
    }
    
    const amount = thirdMatch[1];
    const cgst = thirdMatch[2];
    const descriptionPart = thirdMatch[3];
    
    processItem(block, idx, hpcnSuffix, hsn, pkg, qty, unit, rate, amount, cgst, descriptionPart);
    
  } catch (error) {
    console.error(`Block ${idx + 1}: Error in processParsedMatch:`, error);
    failureCount++;
  }
}

function processItem(block, idx, hpcnSuffix, hsn, pkg, qty, unit, rate, amount, cgst, descriptionPart) {
  try {
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
    
    // Validation with more lenient tolerance
    const parsedAmount = parseFloat(amount);
    const parsedRate = parseFloat(rate);
    const parsedQty = parseFloat(qty);
    const expectedAmount = parsedRate * parsedQty;
    
    if (Math.abs(parsedAmount - expectedAmount) > 0.01) {
      console.warn(`Block ${idx + 1}: Amount validation failed. Expected: ${expectedAmount}, Got: ${parsedAmount}`);
      // Don't skip the item, just log the warning
    }
    
    const item = {
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
    
    parsed.push(item);
    successCount++;
    
  } catch (error) {
    console.error(`Block ${idx + 1}: Error in processItem:`, error);
    failureCount++;
  }
}

console.log(`Parsing complete: ${successCount} successful, ${failureCount} failed`);

if (parsed.length === 0) {
  console.error("No items parsed successfully");
  return [{ json: { error: "Parsing failed", totalBlocks: itemBlocks.length, raw: itemBlocks.slice(0, 3), debug: "Check console for detailed errors" } }];
}

console.log(`Final result: ${parsed.length} items will be returned`);
return parsed.map(row => ({ json: row }));
