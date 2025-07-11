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
    const fullDescription = (descriptionPart + ' ' + remainingLines.join(' ')).trim();
    
    // Extract SGST from the description (it's usually the last number)
    const numbers = fullDescription.match(/\d+(?:\.\d+)?/g) || [];
    let sgst = '0';
    let cleanDesc = fullDescription;
    
    if (numbers.length > 0) {
      // The last number is likely SGST
      sgst = numbers[numbers.length - 1];
      // Remove the last occurrence of this number
      const lastIndex = fullDescription.lastIndexOf(sgst);
      if (lastIndex !== -1) {
        cleanDesc = fullDescription.substring(0, lastIndex) + fullDescription.substring(lastIndex + sgst.length);
      }
    }
    
    // Clean up description
    cleanDesc = cleanDesc.replace(/^\s*/, '').replace(/\s*$/, '');
    let description = 'TWW ' + cleanDescription(cleanDesc);
    description = description.replace(/\s+/g, ' ').trim();
    
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
