function calculateMean(values) {
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

function calculateStandardDeviation(values, mean) {
  const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function calculateConfidenceIntervalForFrequency(values) {
  const mean = calculateMean(values);
  const stdev = calculateStandardDeviation(values, mean);
  const n = values.length;

  const marginOfError = 1.645 * (stdev / Math.sqrt(n));

  return {
      lower: mean - marginOfError,
      upper: mean + marginOfError,
  };
}

function calculateConfidenceIntervals(rawChannels) {
  const numFrequencies = rawChannels[0].length; // 480 ppo

  const upperBounds = [];
  const lowerBounds = [];

  for (let i = 0; i < numFrequencies; i++) {
      const frequency = rawChannels[0][i][0]; // assumes all measurements have the same frequencies
      const dBs = rawChannels.map(measurement => measurement[i][1]); 

      const confidenceInterval = calculateConfidenceIntervalForFrequency(dBs);
        upperBounds.push([frequency, confidenceInterval.upper]);
        lowerBounds.push([frequency, confidenceInterval.lower]);
  }

  console.log([upperBounds, lowerBounds]);

  // Prompt user to download upper bounds
  function downloadFile(data, filename) {
    const formattedData = data.map(item => item.join(', ')).join('\n');
    const blob = new Blob([formattedData], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  // uncomment one at a time to download the lower and upper bounds, limitations of browser
  // downloadFile(lowerBounds, 'lower_bounds.txt');
  // downloadFile(upperBounds, 'upper_bounds.txt');
  return [upperBounds, lowerBounds];
}


function setBoundsPhone(p, ch) {
  let inclusionName = " 90% Confidence Interval"; // edit this to change the name of the confidence interval
  let confidencePhone = {
    brand: p.brand, dispBrand: p.dispBrand, is90Bounds: true,
    phone: p.dispName + inclusionName, fullName: p.fullName + inclusionName,
    dispName: p.dispName + inclusionName, fileName: p.fullName + inclusionName,
    rawChannels: ch, channels: ch, lr: ch, norm: p.norm, id: -69
  }

  return confidencePhone;
}

// Calculate min/max spread for frequency response data
function calculateMinMaxSpread(rawChannels) {
  const numFrequencies = rawChannels[0].length;
  const upperBounds = [];
  const lowerBounds = [];

  for (let i = 0; i < numFrequencies; i++) {
      const frequency = rawChannels[0][i][0];
      const dBs = rawChannels.map(measurement => measurement[i][1]);
      const minValue = Math.min(...dBs);
      const maxValue = Math.max(...dBs);
      upperBounds.push([frequency, maxValue]);
      lowerBounds.push([frequency, minValue]);
  }

  return [upperBounds, lowerBounds];
}

const spreadName = " Measurement Spread";

function setSpreadPhone(p, ch) {
  let basePhone = p.eqParent || p;
  let spreadPhone = {
    brand: p.brand, dispBrand: p.dispBrand, isSpread: true,
    phone: p.dispName + spreadName, fullName: p.fullName + spreadName,
    dispName: p.dispName + spreadName, fileName: p.fullName + spreadName,
    rawChannels: ch, channels: ch, lr: ch, norm: basePhone.norm, offset: basePhone.offset || 0,
    spreadParent: p,
    hexColor: p.hexColor,
    id: -68
  }

  return spreadPhone;
}
