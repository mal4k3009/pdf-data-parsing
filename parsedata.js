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
    if (block.length < 3) {
      console.warn(`Insufficient data in block ${idx + 1}`);
      return null;
    }
    const firstLine = block[0].trim();
    const firstMatch = firstLine.match(/^TWW\s+(\d{8})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\w+)\s+(\d+(?:\.\d+)?)$/);
    if (!firstMatch) {
      console.warn(`Failed to parse first line: ${firstLine}`);
      return null;
    }
    const [_, hsn, pkg, qty, unit, rate] = firstMatch;
    const serialLine = block[1] ? block[1].trim() : '';
    const thirdLine = block[2] ? block[2].trim() : '';
    const thirdMatch = thirdLine.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(.*)$/);
    if (!thirdMatch) {
      console.warn(`Failed to parse third line: ${thirdLine}`);
      return null;
    }
    const amount = thirdMatch[1];
    let cgst = thirdMatch[2];
    let descriptionPart = thirdMatch[3];
    const remainingLines = block.slice(3);
    let fullDescription = (descriptionPart + ' ' + remainingLines.join(' ')).trim();
    const originalDescPart = thirdMatch[3];
    const originalRemaining = remainingLines.join(' ');
    const originalCombined = (originalDescPart + ' ' + originalRemaining).trim();
    const tokens = originalCombined.split(/\s+/).filter(token => token.length > 0);
    let sgst = '0';
    if (tokens.length > 0) {
      const lastToken = tokens[tokens.length - 1];
      if (/^\d+(?:\.\d+)?$/.test(lastToken)) {
        sgst = lastToken;
        tokens.pop();
        fullDescription = tokens.join(' ');
      }
    }
    if (sgst === '0') {
      sgst = cgst;
    }
    fullDescription = fullDescription.replace(/^\s*/, '').replace(/\s*$/, '');
    if (sgst !== '0') {
      const sgstPattern = new RegExp('\\s+' + sgst.replace('.', '\\.') + '(?=\\s|$)', 'g');
      fullDescription = fullDescription.replace(sgstPattern, '');
    }
    let description = 'TWW ' + cleanDescription(fullDescription);
    description = description.replace(/\s+/g, ' ').trim();
    description = description.replace(/\s*-\s*/g, '-');
    description = description.replace(/(\d+)\s+([A-Z])$/g, '$1$2');
    description = description.replace(/(\d+)\s+([A-Z])(?=\s|$)/g, '$1$2');
    description = description.replace(/\b([A-Z])\s+([A-Z]{2,})\b/g, '$1$2');
    description = description.replace(/-(\w+)\s+(\w+)/g, '-$1$2');
    description = description.replace(/\s+([A-Z0-9]+)$/g, '$1');
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
