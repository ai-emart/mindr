import { createHash } from 'crypto'
import Parser from 'tree-sitter'
import JavaScript from 'tree-sitter-javascript'
import Python from 'tree-sitter-python'
import TypeScriptGrammars from 'tree-sitter-typescript'

export type SupportedFingerprintLanguage = 'typescript' | 'javascript' | 'python'

interface TreeSitterLanguage {
  name?: string
}

const TYPE_ALIASES = new Map<string, SupportedFingerprintLanguage>([
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['typescript', 'typescript'],
  ['js', 'javascript'],
  ['jsx', 'javascript'],
  ['javascript', 'javascript'],
  ['py', 'python'],
  ['python', 'python'],
])

const LITERAL_OR_IDENTIFIER = new Set([
  'identifier',
  'property_identifier',
  'shorthand_property_identifier',
  'type_identifier',
  'string',
  'string_fragment',
  'number',
  'true',
  'false',
  'null',
  'undefined',
  'comment',
  'template_string',
  'integer',
  'float',
])

function normalizeLanguage(language: string): SupportedFingerprintLanguage {
  const normalized = TYPE_ALIASES.get(language.toLowerCase())
  if (!normalized) throw new Error(`Unsupported fingerprint language: ${language}`)
  return normalized
}

function parserLanguage(language: SupportedFingerprintLanguage): TreeSitterLanguage {
  if (language === 'typescript') return TypeScriptGrammars.typescript as TreeSitterLanguage
  if (language === 'javascript') return JavaScript as TreeSitterLanguage
  return Python as TreeSitterLanguage
}

function structuralNode(node: Parser.SyntaxNode): string {
  if (LITERAL_OR_IDENTIFIER.has(node.type)) return node.type
  const named = node.namedChildren.filter((child) => !LITERAL_OR_IDENTIFIER.has(child.type) || child.namedChildCount > 0)
  if (named.length === 0) return node.type
  return `${node.type}(${named.map(structuralNode).join(',')})`
}

export function structuralShape(astSnippet: string, language: string): string {
  const normalized = normalizeLanguage(language)
  const parser = new Parser()
  parser.setLanguage(parserLanguage(normalized))
  const tree = parser.parse(astSnippet)
  return `${normalized}:${structuralNode(tree.rootNode)}`
}

export function fingerprint(astSnippet: string, language: string): string {
  return createHash('sha256').update(structuralShape(astSnippet, language)).digest('hex').slice(0, 24)
}

const FUNCTION_NODE_TYPES = new Set([
  'function_declaration',
  'method_definition',
  'function',
  'arrow_function',
  'generator_function_declaration',
  'function_definition',
])

function collectFunctions(node: Parser.SyntaxNode, out: Parser.SyntaxNode[]): void {
  if (FUNCTION_NODE_TYPES.has(node.type)) {
    out.push(node)
    return
  }
  for (const child of node.namedChildren) collectFunctions(child, out)
}

export interface FunctionFingerprint {
  hash: string
  shape: string
  code: string
}

export function functionFingerprints(code: string, language: string): FunctionFingerprint[] {
  const normalized = normalizeLanguage(language)
  const parser = new Parser()
  parser.setLanguage(parserLanguage(normalized))
  const tree = parser.parse(code)
  const functions: Parser.SyntaxNode[] = []
  collectFunctions(tree.rootNode, functions)
  const targets = functions.length > 0 ? functions : [tree.rootNode]
  return targets.map((node) => {
    const snippet = code.slice(node.startIndex, node.endIndex)
    const shape = `${normalized}:${structuralNode(node)}`
    return {
      hash: createHash('sha256').update(shape).digest('hex').slice(0, 24),
      shape,
      code: snippet,
    }
  })
}
