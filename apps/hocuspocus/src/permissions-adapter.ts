import {
  resolveRole as coreResolveRole,
  canRead as coreCanRead,
  canWrite as coreCanWrite,
  canComment as coreCanComment,
} from "@opencairn/api/public";
import type { ResolvedRole, ResourceType } from "@opencairn/api/public";
import type { DB } from "@opencairn/db";

// Plan 2B Task 10: hocuspocus는 apps/api와 별개의 postgres pool을 소유한다.
// @opencairn/api의 권한 헬퍼를 그대로 재사용하되 hocuspocus가 만든 DB 인스턴스를
// 명시적으로 주입 — 같은 프로세스로 번들될 때도 pool 공유를 막는다.

export interface PermissionsAdapter {
  resolveRole: (
    userId: string,
    resource: { type: ResourceType; id: string },
  ) => Promise<ResolvedRole>;
  canRead: (
    userId: string,
    resource: { type: ResourceType; id: string },
  ) => Promise<boolean>;
  canWrite: (
    userId: string,
    resource: { type: ResourceType; id: string },
  ) => Promise<boolean>;
  canComment: (
    userId: string,
    resource: { type: ResourceType; id: string },
  ) => Promise<boolean>;
}

export function makePermissionsAdapter(db: DB): PermissionsAdapter {
  return {
    resolveRole: (userId, resource) => coreResolveRole(userId, resource, { db }),
    canRead: (userId, resource) => coreCanRead(userId, resource, { db }),
    canWrite: (userId, resource) => coreCanWrite(userId, resource, { db }),
    canComment: (userId, resource) => coreCanComment(userId, resource, { db }),
  };
}

// Convenience: resolveRole만 필요한 호출자용 (예: onAuthenticate 훅).
export function makeResolveRole(db: DB) {
  return (userId: string, resource: { type: ResourceType; id: string }) =>
    coreResolveRole(userId, resource, { db });
}
