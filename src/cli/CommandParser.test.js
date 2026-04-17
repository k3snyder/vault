import { CommandParser } from './CommandParser.js';

describe('CommandParser', () => {
  let parser;

  beforeEach(() => {
    parser = new CommandParser();
  });

  describe('parseCommand', () => {
    test('should parse simple command', () => {
      const result = parser.parseCommand('ls');
      expect(result).toEqual({
        command: 'ls',
        args: [],
        options: {},
        raw: 'ls'
      });
    });

    test('should parse command with arguments', () => {
      const result = parser.parseCommand('echo hello world');
      expect(result).toEqual({
        command: 'echo',
        args: ['hello', 'world'],
        options: {},
        raw: 'echo hello world'
      });
    });

    test('should parse command with short options', () => {
      const result = parser.parseCommand('ls -la');
      expect(result).toEqual({
        command: 'ls',
        args: [],
        options: {
          l: true,
          a: true
        },
        raw: 'ls -la'
      });
    });

    test('should parse command with long options', () => {
      const result = parser.parseCommand('npm install --save-dev');
      expect(result).toEqual({
        command: 'npm',
        args: ['install'],
        options: {
          'save-dev': true
        },
        raw: 'npm install --save-dev'
      });
    });

    test('should parse command with option values', () => {
      const result = parser.parseCommand('git commit -m "test message"');
      expect(result).toEqual({
        command: 'git',
        args: ['commit'],
        options: {
          m: 'test message'
        },
        raw: 'git commit -m "test message"'
      });
    });

    test('should handle quoted arguments', () => {
      const result = parser.parseCommand('echo "hello world" test');
      expect(result).toEqual({
        command: 'echo',
        args: ['hello world', 'test'],
        options: {},
        raw: 'echo "hello world" test'
      });
    });

    test('should handle escaped quotes', () => {
      const result = parser.parseCommand('echo "test \\"quoted\\" text"');
      expect(result).toEqual({
        command: 'echo',
        args: ['test "quoted" text'],
        options: {},
        raw: 'echo "test \\"quoted\\" text"'
      });
    });

    test('should handle empty command', () => {
      const result = parser.parseCommand('');
      expect(result).toBeNull();
    });

    test('should handle whitespace-only command', () => {
      const result = parser.parseCommand('   ');
      expect(result).toBeNull();
    });

    test('should parse complex command with mixed options', () => {
      const result = parser.parseCommand('docker run -it --rm --name test -p 8080:80 nginx');
      expect(result).toEqual({
        command: 'docker',
        args: ['run', 'nginx'],
        options: {
          i: true,
          t: true,
          rm: true,
          name: 'test',
          p: '8080:80'
        },
        raw: 'docker run -it --rm --name test -p 8080:80 nginx'
      });
    });

    test('should handle equals sign in long options', () => {
      const result = parser.parseCommand('node --max-old-space-size=4096 app.js');
      expect(result).toEqual({
        command: 'node',
        args: ['app.js'],
        options: {
          'max-old-space-size': '4096'
        },
        raw: 'node --max-old-space-size=4096 app.js'
      });
    });

    test('should handle pipe operators', () => {
      const result = parser.parseCommand('ls -la | grep test');
      expect(result).toEqual({
        command: 'ls',
        args: [],
        options: {
          l: true,
          a: true
        },
        pipe: {
          command: 'grep',
          args: ['test'],
          options: {},
          raw: 'grep test'
        },
        raw: 'ls -la | grep test'
      });
    });

    test('should handle redirection operators', () => {
      const result = parser.parseCommand('echo "test" > output.txt');
      expect(result).toEqual({
        command: 'echo',
        args: ['test'],
        options: {},
        redirect: {
          type: '>',
          target: 'output.txt'
        },
        raw: 'echo "test" > output.txt'
      });
    });

    test('should handle append redirection', () => {
      const result = parser.parseCommand('echo "more" >> output.txt');
      expect(result).toEqual({
        command: 'echo',
        args: ['more'],
        options: {},
        redirect: {
          type: '>>',
          target: 'output.txt'
        },
        raw: 'echo "more" >> output.txt'
      });
    });

    test('should handle background operator', () => {
      const result = parser.parseCommand('npm start &');
      expect(result).toEqual({
        command: 'npm',
        args: ['start'],
        options: {},
        background: true,
        raw: 'npm start &'
      });
    });

    test('should handle command chaining with &&', () => {
      const result = parser.parseCommand('npm test && npm build');
      expect(result).toEqual({
        command: 'npm',
        args: ['test'],
        options: {},
        chain: {
          operator: '&&',
          next: {
            command: 'npm',
            args: ['build'],
            options: {},
            raw: 'npm build'
          }
        },
        raw: 'npm test && npm build'
      });
    });

    test('should handle command chaining with ||', () => {
      const result = parser.parseCommand('npm test || echo "Tests failed"');
      expect(result).toEqual({
        command: 'npm',
        args: ['test'],
        options: {},
        chain: {
          operator: '||',
          next: {
            command: 'echo',
            args: ['Tests failed'],
            options: {},
            raw: 'echo "Tests failed"'
          }
        },
        raw: 'npm test || echo "Tests failed"'
      });
    });

    test('should handle semicolon command separator', () => {
      const result = parser.parseCommand('cd /tmp; ls');
      expect(result).toEqual({
        command: 'cd',
        args: ['/tmp'],
        options: {},
        chain: {
          operator: ';',
          next: {
            command: 'ls',
            args: [],
            options: {},
            raw: 'ls'
          }
        },
        raw: 'cd /tmp; ls'
      });
    });

    test('should preserve original command string', () => {
      const command = 'git   commit   -m   "test"   --amend';
      const result = parser.parseCommand(command);
      expect(result.raw).toBe(command);
    });
  });

  describe('tokenize', () => {
    test('should tokenize simple command', () => {
      const tokens = parser.tokenize('ls -la');
      expect(tokens).toEqual(['ls', '-la']);
    });

    test('should handle quoted strings', () => {
      const tokens = parser.tokenize('echo "hello world"');
      expect(tokens).toEqual(['echo', 'hello world']);
    });

    test('should handle single quotes', () => {
      const tokens = parser.tokenize("echo 'hello world'");
      expect(tokens).toEqual(['echo', 'hello world']);
    });

    test('should handle mixed quotes', () => {
      const tokens = parser.tokenize('echo "hello" \'world\'');
      expect(tokens).toEqual(['echo', 'hello', 'world']);
    });

    test('should handle escaped characters', () => {
      const tokens = parser.tokenize('echo test\\ file');
      expect(tokens).toEqual(['echo', 'test file']);
    });

    test('should handle empty input', () => {
      const tokens = parser.tokenize('');
      expect(tokens).toEqual([]);
    });

    test('should handle special characters in quotes', () => {
      const tokens = parser.tokenize('echo "test | > < & ;"');
      expect(tokens).toEqual(['echo', 'test | > < & ;']);
    });
  });

  describe('isValidCommand', () => {
    test('should validate non-empty commands', () => {
      expect(parser.isValidCommand('ls')).toBe(true);
      expect(parser.isValidCommand('echo test')).toBe(true);
    });

    test('should reject empty commands', () => {
      expect(parser.isValidCommand('')).toBe(false);
      expect(parser.isValidCommand('   ')).toBe(false);
      expect(parser.isValidCommand(null)).toBe(false);
      expect(parser.isValidCommand(undefined)).toBe(false);
    });

    test('should reject commands with only special characters', () => {
      expect(parser.isValidCommand('|')).toBe(false);
      expect(parser.isValidCommand('>')).toBe(false);
      expect(parser.isValidCommand('&')).toBe(false);
    });
  });

  describe('extractOptions', () => {
    test('should extract short options', () => {
      const tokens = ['-la', '-h'];
      const { options, remaining } = parser.extractOptions(tokens);
      expect(options).toEqual({ l: true, a: true, h: true });
      expect(remaining).toEqual([]);
    });

    test('should extract long options', () => {
      const tokens = ['--verbose', '--output=test.txt'];
      const { options, remaining } = parser.extractOptions(tokens);
      expect(options).toEqual({ verbose: true, output: 'test.txt' });
      expect(remaining).toEqual([]);
    });

    test('should extract mixed options and arguments', () => {
      const tokens = ['-v', 'file.txt', '--force'];
      const { options, remaining } = parser.extractOptions(tokens);
      expect(options).toEqual({ v: true, force: true });
      expect(remaining).toEqual(['file.txt']);
    });

    test('should handle option values', () => {
      const tokens = ['-m', 'commit message', '-a'];
      const { options, remaining } = parser.extractOptions(tokens);
      expect(options).toEqual({ m: 'commit message', a: true });
      expect(remaining).toEqual([]);
    });

    test('should stop at double dash', () => {
      const tokens = ['-v', '--', '-not-an-option'];
      const { options, remaining } = parser.extractOptions(tokens);
      expect(options).toEqual({ v: true });
      expect(remaining).toEqual(['-not-an-option']);
    });
  });
});