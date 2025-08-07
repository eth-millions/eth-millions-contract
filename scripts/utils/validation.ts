export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class InputValidator {
  static validateMainNumbers(numbers: number[]): void {
    if (!Array.isArray(numbers) || numbers.length !== 5) {
      throw new ValidationError("Main numbers must be an array of exactly 5 numbers");
    }

    for (const num of numbers) {
      if (!Number.isInteger(num) || num < 1 || num > 50) {
        throw new ValidationError("Main numbers must be integers between 1 and 50");
      }
    }

    const uniqueNumbers = new Set(numbers);
    if (uniqueNumbers.size !== numbers.length) {
      throw new ValidationError("Main numbers must be unique");
    }
  }

  static validateLuckyStars(stars: number[]): void {
    if (!Array.isArray(stars) || stars.length !== 2) {
      throw new ValidationError("Lucky stars must be an array of exactly 2 numbers");
    }

    for (const star of stars) {
      if (!Number.isInteger(star) || star < 1 || star > 12) {
        throw new ValidationError("Lucky stars must be integers between 1 and 12");
      }
    }

    if (stars[0] === stars[1]) {
      throw new ValidationError("Lucky stars must be unique");
    }
  }

  static validateEthereumAddress(address: string): void {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new ValidationError("Invalid Ethereum address format");
    }
  }

  static validatePrivateKey(privateKey: string): void {
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
      throw new ValidationError("Invalid private key format");
    }
  }
}
