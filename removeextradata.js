// Clean up trailing GST rates and unwanted numbers from descriptions
const cleanedData = $input.all().map(item => {
  const data = item.json;
  
  // Remove trailing GST rates and unwanted patterns from description if it exists
  if (data.description) {
    let desc = data.description;
    
    // Log original description for debugging
    console.log('Original description:', desc);
    
    // Remove trailing "9.00" and other GST rates - be more aggressive
    desc = desc.replace(/\s*9\.00\s*$/gi, '');
    desc = desc.replace(/\s*(18\.00|12\.00|5\.00|28\.00)\s*$/gi, '');
    
    // Remove any trailing decimal numbers that look like GST rates
    desc = desc.replace(/\s*\d+\.00\s*$/gi, '');
    
    // Remove invoice continuation patterns anywhere in the string
    desc = desc.replace(/\s+[\d\.]+\s+PCS\s+[\d\.]+\s+[\d\.]+\s+[\d\.]+[A-Z\s]*$/gi, '');
    desc = desc.replace(/\s+TWW-HPCN\d+.*$/gi, '');
    
    // Remove patterns like "69.00" that might be at the end but are GST rates, not product codes
    // Only if they follow a dash or space (to avoid removing legitimate product numbers)
    desc = desc.replace(/[-\s]+\d+\.00$/gi, '');
    
    // Clean up any double spaces and trim
    desc = desc.replace(/\s+/g, ' ').trim();
    
    // Log cleaned description for debugging
    console.log('Cleaned description:', desc);
    
    data.description = desc;
  }
  
  return { json: data };
});

return cleanedData;
