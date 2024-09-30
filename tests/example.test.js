// tests/example.test.js

// Import the module or function you want to test
// For demonstration purposes, let's assume we have a function named `sum` in a module `utils.js`
// import { sum } from '../src/utils';

// Example function to test
function sum(a, b) {
  return a + b;
}

// Describe block for grouping related tests
describe('Example Test Suite', () => {
  // Individual test case
  it('should return the correct sum of two numbers', () => {
    const result = sum(1, 2);
    expect(result).toBe(3);
  });

  // Another test case
  it('should return 0 when both numbers are 0', () => {
    const result = sum(0, 0);
    expect(result).toBe(0);
  });

  // Test case for negative numbers
  it('should correctly sum negative numbers', () => {
    const result = sum(-1, -2);
    expect(result).toBe(-3);
  });
});

