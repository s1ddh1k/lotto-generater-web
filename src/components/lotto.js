function isDuplicatedNumber(number, excludedNumbers, selectedNumbers) {
  return excludedNumbers.find(e => e === number) || selectedNumbers.find(e => e === number)
}

// NOTE: Every numbers are array of string
function generateOneNumber(excludedNumbers, selectedNumbers) {
  const min = 1
  const max = 45

  // TODO: Use better random number generator
  let duplicate = true;
  let generatedNumber = '';
  while (duplicate) {
    generatedNumber = Math.floor(Math.random() * (max - min + 1) + min)
    if (generatedNumber < 10) {
      generatedNumber = '0' + generatedNumber
    } else {
      generatedNumber = generatedNumber.toString()
    }
    duplicate = isDuplicatedNumber(generatedNumber, excludedNumbers, selectedNumbers)
  }
  return generatedNumber
}

function generateOneGame(excludedNumbers) {
  const selectedNumbers = []
  for (let i = 0; i < 6; i++) {
    const selected = generateOneNumber(excludedNumbers, selectedNumbers)
    selectedNumbers.push(selected)
  }
  return selectedNumbers.sort()
}

export function generateFiveGame(excludedNumbers) {
  let generated = [];

  for (let i = 0; i < 5; i++) {
    const oneGameNumbers = generateOneGame(excludedNumbers);
    generated = generated.concat(oneGameNumbers);
  }

  return generated;
}

export function parseNumbersFromUrl(url) {
  const startIndex = url.indexOf('q') + 1
  const endIndex = url.length - 10 // Last 10 characters are lotto episode number
  const numbers = url.slice(startIndex, endIndex).split('q').join('')
  const result = numbers.match(/.{1,2}/g)
  return result
}

export default {
  generateFiveGame,
  parseNumbersFromUrl,
}