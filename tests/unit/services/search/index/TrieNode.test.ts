/**
 * Unit tests for TrieNode
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TrieNode } from '../../../../../src/services/search/index/TrieNode.js';
import { IndexField } from '../../../../../src/models/IndexModels.js';
import type { DocumentPosting } from '../../../../../src/models/IndexModels.js';

describe('TrieNode', () => {
  let node: TrieNode;

  beforeEach(() => {
    node = new TrieNode();
  });

  describe('constructor', () => {
    it('should create an empty node', () => {
      expect(node.children.size).toBe(0);
      expect(node.isEndOfWord).toBe(false);
      expect(node.postings).toEqual([]);
    });
  });

  describe('addChild', () => {
    it('should add a new child node', () => {
      const child = node.addChild('a');

      expect(node.children.size).toBe(1);
      expect(node.hasChild('a')).toBe(true);
      expect(child).toBeInstanceOf(TrieNode);
    });

    it('should return existing child if already present', () => {
      const child1 = node.addChild('a');
      const child2 = node.addChild('a');

      expect(child1).toBe(child2);
      expect(node.children.size).toBe(1);
    });

    it('should handle multiple children', () => {
      node.addChild('a');
      node.addChild('b');
      node.addChild('c');

      expect(node.children.size).toBe(3);
      expect(node.hasChild('a')).toBe(true);
      expect(node.hasChild('b')).toBe(true);
      expect(node.hasChild('c')).toBe(true);
    });
  });

  describe('getChild', () => {
    it('should return child node if exists', () => {
      const child = node.addChild('x');
      const retrieved = node.getChild('x');

      expect(retrieved).toBe(child);
    });

    it('should return undefined if child does not exist', () => {
      expect(node.getChild('z')).toBeUndefined();
    });
  });

  describe('hasChild', () => {
    it('should return true for existing child', () => {
      node.addChild('m');
      expect(node.hasChild('m')).toBe(true);
    });

    it('should return false for non-existent child', () => {
      expect(node.hasChild('n')).toBe(false);
    });
  });

  describe('markAsEndOfWord', () => {
    it('should mark node as end of word', () => {
      const postings: DocumentPosting[] = [{
        docId: 'doc1',
        termFrequency: 5,
        positions: [1, 5, 10],
        fieldScores: [{
          field: IndexField.CONTENT,
          frequency: 5,
          boost: 1.0,
        }],
      }];

      node.markAsEndOfWord(postings);

      expect(node.isEndOfWord).toBe(true);
      expect(node.postings).toEqual(postings);
    });
  });

  describe('addPosting', () => {
    it('should add a posting to the node', () => {
      const posting: DocumentPosting = {
        docId: 'doc2',
        termFrequency: 3,
        positions: [2, 4, 6],
        fieldScores: [{
          field: IndexField.TITLE,
          frequency: 1,
          boost: 2.0,
        }],
      };

      node.addPosting(posting);

      expect(node.postings).toHaveLength(1);
      expect(node.postings[0]).toBe(posting);
    });

    it('should add multiple postings', () => {
      const posting1: DocumentPosting = {
        docId: 'doc1',
        termFrequency: 1,
        positions: [0],
        fieldScores: [],
      };
      const posting2: DocumentPosting = {
        docId: 'doc2',
        termFrequency: 2,
        positions: [0, 5],
        fieldScores: [],
      };

      node.addPosting(posting1);
      node.addPosting(posting2);

      expect(node.postings).toHaveLength(2);
      expect(node.postings[0]).toBe(posting1);
      expect(node.postings[1]).toBe(posting2);
    });
  });

  describe('removePosting', () => {
    beforeEach(() => {
      node.addPosting({
        docId: 'doc1',
        termFrequency: 1,
        positions: [0],
        fieldScores: [],
      });
      node.addPosting({
        docId: 'doc2',
        termFrequency: 2,
        positions: [0, 5],
        fieldScores: [],
      });
    });

    it('should remove a posting by docId', () => {
      const removed = node.removePosting('doc1');

      expect(removed).toBe(true);
      expect(node.postings).toHaveLength(1);
      expect(node.postings[0].docId).toBe('doc2');
    });

    it('should return false if posting not found', () => {
      const removed = node.removePosting('doc3');

      expect(removed).toBe(false);
      expect(node.postings).toHaveLength(2);
    });

    it('should handle removing all postings', () => {
      node.removePosting('doc1');
      node.removePosting('doc2');

      expect(node.postings).toHaveLength(0);
    });
  });

  describe('getPostings', () => {
    it('should return empty array for new node', () => {
      expect(node.getPostings()).toEqual([]);
    });

    it('should return all postings', () => {
      const posting: DocumentPosting = {
        docId: 'doc1',
        termFrequency: 1,
        positions: [0],
        fieldScores: [],
      };

      node.addPosting(posting);

      expect(node.getPostings()).toEqual([posting]);
    });
  });

  describe('hasChildren', () => {
    it('should return false for node with no children', () => {
      expect(node.hasChildren()).toBe(false);
    });

    it('should return true for node with children', () => {
      node.addChild('a');
      expect(node.hasChildren()).toBe(true);
    });
  });

  describe('getChildCount', () => {
    it('should return 0 for node with no children', () => {
      expect(node.getChildCount()).toBe(0);
    });

    it('should return correct count', () => {
      node.addChild('a');
      node.addChild('b');
      node.addChild('c');

      expect(node.getChildCount()).toBe(3);
    });
  });

  describe('removeChild', () => {
    it('should remove a child node', () => {
      node.addChild('x');
      const removed = node.removeChild('x');

      expect(removed).toBe(true);
      expect(node.hasChild('x')).toBe(false);
    });

    it('should return false if child does not exist', () => {
      const removed = node.removeChild('y');
      expect(removed).toBe(false);
    });
  });

  describe('clearPostings', () => {
    it('should clear all postings and end-of-word flag', () => {
      node.markAsEndOfWord([{
        docId: 'doc1',
        termFrequency: 1,
        positions: [0],
        fieldScores: [],
      }]);

      node.clearPostings();

      expect(node.postings).toEqual([]);
      expect(node.isEndOfWord).toBe(false);
    });
  });

  describe('toJSON and fromJSON', () => {
    it('should serialize a simple node', () => {
      const json = node.toJSON();

      expect(json).toEqual({
        isEndOfWord: false,
        postings: [],
        children: {},
      });
    });

    it('should serialize a node with postings', () => {
      const posting: DocumentPosting = {
        docId: 'doc1',
        termFrequency: 3,
        positions: [1, 2, 3],
        fieldScores: [{
          field: IndexField.CONTENT,
          frequency: 3,
          boost: 1.0,
        }],
      };

      node.markAsEndOfWord([posting]);
      const json = node.toJSON();

      expect(json.isEndOfWord).toBe(true);
      expect(json.postings).toEqual([posting]);
    });

    it('should serialize and deserialize a node tree', () => {
      // Build a simple tree: root -> 'c' -> 'a' -> 't'
      const childC = node.addChild('c');
      const childA = childC.addChild('a');
      const childT = childA.addChild('t');

      childT.markAsEndOfWord([{
        docId: 'doc1',
        termFrequency: 1,
        positions: [0],
        fieldScores: [],
      }]);

      const json = node.toJSON();
      const restored = TrieNode.fromJSON(json);

      expect(restored.hasChild('c')).toBe(true);

      const restoredC = restored.getChild('c')!;
      expect(restoredC.hasChild('a')).toBe(true);

      const restoredA = restoredC.getChild('a')!;
      expect(restoredA.hasChild('t')).toBe(true);

      const restoredT = restoredA.getChild('t')!;
      expect(restoredT.isEndOfWord).toBe(true);
      expect(restoredT.postings).toHaveLength(1);
      expect(restoredT.postings[0].docId).toBe('doc1');
    });
  });

  describe('getMemoryUsage', () => {
    it('should return positive memory estimate', () => {
      const memory = node.getMemoryUsage();
      expect(memory).toBeGreaterThan(0);
    });

    it('should increase with children and postings', () => {
      const baseMemory = node.getMemoryUsage();

      node.addChild('a');
      node.addPosting({
        docId: 'doc1',
        termFrequency: 1,
        positions: [0],
        fieldScores: [],
      });

      const newMemory = node.getMemoryUsage();
      expect(newMemory).toBeGreaterThan(baseMemory);
    });
  });

  describe('countTerms', () => {
    it('should return 0 for empty tree', () => {
      expect(node.countTerms()).toBe(0);
    });

    it('should return 1 for end-of-word node', () => {
      node.markAsEndOfWord([]);
      expect(node.countTerms()).toBe(1);
    });

    it('should count terms in subtree', () => {
      // Build tree for 'cat', 'car', 'card'
      const childC = node.addChild('c');
      const childA = childC.addChild('a');

      const childT = childA.addChild('t');
      childT.markAsEndOfWord([]); // 'cat'

      const childR = childA.addChild('r');
      childR.markAsEndOfWord([]); // 'car'

      const childD = childR.addChild('d');
      childD.markAsEndOfWord([]); // 'card'

      expect(node.countTerms()).toBe(3);
    });
  });

  describe('getAllTerms', () => {
    it('should return empty array for empty tree', () => {
      expect(node.getAllTerms()).toEqual([]);
    });

    it('should return single term', () => {
      node.markAsEndOfWord([]);
      const terms = node.getAllTerms();

      expect(terms).toHaveLength(1);
      expect(terms[0][0]).toBe('');
    });

    it('should return all terms with postings', () => {
      // Build tree for 'cat', 'car'
      const childC = node.addChild('c');
      const childA = childC.addChild('a');

      const posting1: DocumentPosting = {
        docId: 'doc1',
        termFrequency: 1,
        positions: [0],
        fieldScores: [],
      };

      const posting2: DocumentPosting = {
        docId: 'doc2',
        termFrequency: 1,
        positions: [0],
        fieldScores: [],
      };

      const childT = childA.addChild('t');
      childT.markAsEndOfWord([posting1]);

      const childR = childA.addChild('r');
      childR.markAsEndOfWord([posting2]);

      const terms = childC.getAllTerms('c');

      expect(terms).toHaveLength(2);
      expect(terms.map(t => t[0]).sort()).toEqual(['car', 'cat']);
      expect(terms.find(t => t[0] === 'cat')?.[1]).toEqual([posting1]);
      expect(terms.find(t => t[0] === 'car')?.[1]).toEqual([posting2]);
    });
  });
});
