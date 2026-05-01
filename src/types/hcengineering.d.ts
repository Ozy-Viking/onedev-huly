/**
 * Ambient declarations for @hcengineering packages.
 *
 * These packages ship source .ts but no compiled .d.ts files (packaging gap).
 * This file provides the minimal signatures we actually call so the rest of
 * the codebase can be strictly typed.
 */

// ---------------------------------------------------------------------------
// @hcengineering/core
// ---------------------------------------------------------------------------

declare module '@hcengineering/core' {
  /** Branded string reference to a document of type T. */
  export type Ref<T> = string & { __ref?: T }

  /** Base document interface. */
  export interface Doc {
    _id: string
    _class: Ref<Class<Doc>>
    space: Ref<Space>
    modifiedOn: number
    modifiedBy: string
    createdOn?: number
    createdBy?: string
  }

  /** A document that is attached to another document via a collection. */
  export interface AttachedDoc extends Doc {
    attachedTo: Ref<Doc>
    attachedToClass: Ref<Class<Doc>>
    collection: string
  }

  /** Class descriptor (used as a type tag for Ref<Class<T>>). */
  export interface Class<T extends Doc> extends Doc {}

  /** Space (project/channel — the document container). */
  export interface Space extends Doc {
    name: string
    description?: string
    members: string[]
    archived: boolean
  }

  /** Generate a new unique document Ref. */
  export function generateId<T extends Doc> (join?: string): Ref<T>

  /**
   * Low-level document operations over a Huly transactor connection.
   * We call these methods with `as any` for document-specific fields because
   * we don't have the tracker model types installed.
   */
  export class TxOperations {
    findAll<T extends Doc> (
      _class: Ref<Class<T>>,
      query: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<T[]>

    findOne<T extends Doc> (
      _class: Ref<Class<T>>,
      query: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<T | undefined>

    createDoc<T extends Doc> (
      _class: Ref<Class<T>>,
      space: Ref<Space>,
      attributes: Record<string, unknown>,
      id?: Ref<T>,
    ): Promise<Ref<T>>

    updateDoc<T extends Doc> (
      _class: Ref<Class<T>>,
      space: Ref<Space>,
      objectId: Ref<T>,
      operations: Record<string, unknown>,
      retrieve?: boolean,
    ): Promise<unknown>

    removeDoc<T extends Doc> (
      _class: Ref<Class<T>>,
      space: Ref<Space>,
      objectId: Ref<T>,
    ): Promise<unknown>

    addCollection<T extends Doc, P extends AttachedDoc> (
      _class: Ref<Class<P>>,
      space: Ref<Space>,
      attachedTo: Ref<T>,
      attachedToClass: Ref<Class<T>>,
      collection: string,
      attributes: Record<string, unknown>,
      id?: Ref<P>,
    ): Promise<Ref<P>>

    updateCollection<T extends Doc, P extends AttachedDoc> (
      _class: Ref<Class<P>>,
      space: Ref<Space>,
      objectId: Ref<P>,
      attachedTo: Ref<T>,
      attachedToClass: Ref<Class<T>>,
      collection: string,
      operations: Record<string, unknown>,
      retrieve?: boolean,
    ): Promise<Ref<T>>

    removeCollection<T extends Doc, P extends AttachedDoc> (
      _class: Ref<Class<P>>,
      space: Ref<Space>,
      objectId: Ref<P>,
      attachedTo: Ref<T>,
      attachedToClass: Ref<Class<T>>,
      collection: string,
    ): Promise<Ref<T>>
  }
}

// ---------------------------------------------------------------------------
// @hcengineering/api-client
// ---------------------------------------------------------------------------

declare module '@hcengineering/api-client' {
  import type { TxOperations } from '@hcengineering/core'

  export interface ServerConfig {
    ACCOUNTS_URL: string
    COLLABORATOR_URL: string
    FILES_URL: string
    UPLOAD_URL: string
  }

  export interface WorkspaceToken {
    endpoint: string
    token: string
    workspaceId: string
  }

  export type AuthOptions =
    | { token: string; workspace: string }
    | { email: string; password: string; workspace: string }

  /**
   * Resolve a workspace token from the account service.
   * Pass `config` to skip fetching /config.json from the server URL.
   */
  export function getWorkspaceToken (
    url: string,
    options: AuthOptions,
    config?: ServerConfig,
  ): Promise<WorkspaceToken>

  /**
   * Create a TxOperations backed by the Huly REST API.
   * No persistent WebSocket required.
   */
  export function createRestTxOperations (
    endpoint: string,
    workspaceId: string,
    token: string,
    fullModel?: boolean,
  ): Promise<TxOperations>
}
