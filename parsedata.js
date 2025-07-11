const rawText = $json.text;
const lines = rawText.split('\n');
const startIndex = lines.findIndex(line => /^TWW\s+/.test(line));
const workingLines = lines.slice(startIndex).filter(line => line.trim() !== '');
const itemBlocks = [];
let currentBlock = [];

for (let line of workingLines) {
  line = line.trim();
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
    "SN DESCRIP", "IFSC", "UBIN", "ONLY", "P.O.No", "DATED", "Vehicle"
  ];
  
  for (const marker of cutMarkers) {
    const i = desc.indexOf(marker);
    if (i !== -1) {
      desc = desc.substring(0, i);
    }
  }
  
  return desc.replace(/\s+/g, ' ').trim();
}

const parsed = itemBlocks.map((block, idx) => {
  try {
    // From your raw data, I can see the pattern:
    // Line 1: "TWW 94042190 1 9.00 PCS 720.00"
    // Line 2: "1" (serial number)
    // Line 3: "6480.00 9.00ADJ HE WP 24-22-12 9.00" (amount, cgst+description)
    // Line 4: "M" (more description)
    
    if (block.length < 3) {
      console.warn(`Insufficient data in block ${idx + 1}`);
      return null;
    }
    
    // Parse the first line: TWW HSN PKG QTY UNIT RATE
    const firstLine = block[0].trim();
    const firstMatch = firstLine.match(/^TWW\s+(\d{8})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\w+)\s+(\d+(?:\.\d+)?)$/);
    
    if (!firstMatch) {
      console.warn(`Failed to parse first line: ${firstLine}`);
      return null;
    }
    
    const [_, hsn, pkg, qty, unit, rate] = firstMatch;
    
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
    
    // Collect remaining description parts
    const remainingLines = block.slice(3);
    
    // Join description parts with single space, then clean up
    let fullDescription = (descriptionPart + ' ' + remainingLines.join(' ')).trim();
    
    // Simple and direct SGST extraction
    // Look at the very last token in the original combined description
    const originalDescPart = thirdMatch[3]; // This is the description part after CGST
    const originalRemaining = remainingLines.join(' ');
    const originalCombined = (originalDescPart + ' ' + originalRemaining).trim();
    
    // Split into tokens and get the last one
    const tokens = originalCombined.split(/\s+/).filter(token => token.length > 0);
    let sgst = '0';
    
    // The last token should be SGST if it's a number
    if (tokens.length > 0) {
      const lastToken = tokens[tokens.length - 1];
      if (/^\d+(?:\.\d+)?$/.test(lastToken)) {
        sgst = lastToken;
        // Remove this last token from the description
        tokens.pop();
        fullDescription = tokens.join(' ');
      }
    }
    
    // If no SGST found, default to CGST (common in tax calculations)
    if (sgst === '0') {
      sgst = cgst;
    }
    
    // Clean up description - extra normalization to handle multiple spaces
    fullDescription = fullDescription.replace(/^\s*/, '').replace(/\s*$/, '');
    
    // Remove any remaining SGST numbers from the description before final processing
    // This handles cases where SGST might still be in the description
    if (sgst !== '0') {
      // Remove the SGST value if it appears in the description
      const sgstPattern = new RegExp('\\s+' + sgst.replace('.', '\\.') + '(?=\\s|$)', 'g');
      fullDescription = fullDescription.replace(sgstPattern, '');
    }
    
    let description = 'TWW ' + cleanDescription(fullDescription);
    
    // More aggressive space cleanup - replace multiple spaces/tabs/newlines with single space
    description = description.replace(/\s+/g, ' ').trim();
    
    // Fix specific spacing issues:
    // 1. Remove spaces around hyphens: "D- BL" -> "D-BL", "LAP- D" -> "LAP-D"
    description = description.replace(/\s*-\s*/g, '-');
    
    // 2. Remove spaces between number and single letter at end: "24-22-12 M" -> "24-22-12M"
    description = description.replace(/(\d+)\s+([A-Z])$/g, '$1$2');
    
    // 3. Remove spaces between number and single letter after hyphen: "24-22-12 W" -> "24-22-12W"
    description = description.replace(/(\d+)\s+([A-Z])(?=\s|$)/g, '$1$2');
    
    // 4. Additional cleanup for specific patterns like "G RY" -> "GRY"
    description = description.replace(/\b([A-Z])\s+([A-Z]{2,})\b/g, '$1$2');
    
    // 5. FIXED: Remove spaces after hyphens followed by letters/numbers
    // This handles cases like "FOT18-11-7B P" -> "FOT18-11-7BP" and "18-7-5G RY" -> "18-7-5GRY"
    description = description.replace(/-(\w+)\s+(\w+)/g, '-$1$2');
    
    // 6. ADDITIONAL: Remove any remaining spaces before single letters/numbers at the end
    description = description.replace(/\s+([A-Z0-9]+)$/g, '$1');
    
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
