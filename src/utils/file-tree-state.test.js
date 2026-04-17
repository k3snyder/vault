import { describe, expect, it } from '@jest/globals'

import {
  areAncestorFoldersExpanded,
  collapseFolderState,
  expandFolderState,
  findFolderPathByName,
  findSketchNavigationTarget
} from './file-tree-state.js'

describe('file-tree-state', () => {
  describe('areAncestorFoldersExpanded', () => {
    it('shows root-level items without requiring expansion', () => {
      expect(areAncestorFoldersExpanded('', new Set())).toBe(true)
      expect(areAncestorFoldersExpanded(null, new Set())).toBe(true)
    })

    it('requires every ancestor to stay expanded', () => {
      const expandedFolders = new Set(['.vault/pdf-highlights'])

      expect(areAncestorFoldersExpanded('.vault/pdf-highlights', expandedFolders)).toBe(false)
    })

    it('allows nested items when the full ancestor chain is expanded', () => {
      const expandedFolders = new Set(['.vault', '.vault/pdf-highlights'])

      expect(areAncestorFoldersExpanded('.vault/pdf-highlights', expandedFolders)).toBe(true)
    })
  })

  describe('collapseFolderState', () => {
    it('removes the collapsed folder and all expanded descendants', () => {
      const expandedFolders = new Set([
        '.vault',
        '.vault/pdf-highlights',
        '.vault/pdf-highlights/deeper',
        'Biz Docs'
      ])

      const nextExpandedFolders = collapseFolderState(expandedFolders, '.vault')

      expect([...nextExpandedFolders]).toEqual(['Biz Docs'])
    })
  })

  describe('expandFolderState', () => {
    it('adds the full ancestor chain for a target folder', () => {
      const nextExpandedFolders = expandFolderState(new Set(['Biz Docs']), 'Sketches/Client Work')

      expect([...nextExpandedFolders]).toEqual([
        'Biz Docs',
        'Sketches',
        'Sketches/Client Work'
      ])
    })
  })

  describe('findFolderPathByName', () => {
    it('finds folders case-insensitively and prefers the shallowest match', () => {
      const files = [
        { is_dir: true, name: 'sketches', path: 'Archive/sketches', depth: 2 },
        { is_dir: true, name: 'Sketches', path: 'Sketches', depth: 1 }
      ]

      expect(findFolderPathByName(files, 'Sketches')).toBe('Sketches')
    })
  })

  describe('findSketchNavigationTarget', () => {
    it('prefers a dedicated Sketches folder', () => {
      const files = [
        { is_dir: true, name: 'Sketches', path: 'Sketches', depth: 1 },
        { is_dir: false, name: 'roadmap.excalidraw', path: 'Random/roadmap.excalidraw', depth: 2, parent_path: 'Random' }
      ]

      expect(findSketchNavigationTarget(files)).toEqual({
        type: 'folder',
        path: 'Sketches'
      })
    })

    it('falls back to the containing folder of the first sketch file', () => {
      const files = [
        { is_dir: false, name: 'roadmap.excalidraw', path: 'Whiteboard/roadmap.excalidraw', depth: 2, parent_path: 'Whiteboard' }
      ]

      expect(findSketchNavigationTarget(files)).toEqual({
        type: 'folder',
        path: 'Whiteboard'
      })
    })

    it('falls back to a root sketch file when no sketch folder exists', () => {
      const files = [
        { is_dir: false, name: 'roadmap.excalidraw', path: 'roadmap.excalidraw', depth: 1, parent_path: '' }
      ]

      expect(findSketchNavigationTarget(files)).toEqual({
        type: 'file',
        path: 'roadmap.excalidraw'
      })
    })
  })
})
