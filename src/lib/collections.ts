export type CollectionView = 'editorial' | 'gallery' | 'timeline';

export type CollectionStatus = 'draft' | 'published';

export type CollectionItemKind = 'capture' | 'text';

export interface Collection {
  id: string;
  ownerUserId: string;
  title: string;
  description: string | null;
  coverPath: string | null;
  defaultView: CollectionView;
  enabledViews: CollectionView[];
  showSummary: boolean;
  showTags: boolean;
  showNotes: boolean;
  status: CollectionStatus;
  shareCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionItem {
  id: string;
  collectionId: string;
  position: number;
  kind: CollectionItemKind;
  nodeId: string | null;
  caption: string | null;
  textBody: string | null;
  createdAt: string;
}

export interface CollectionMember {
  collectionId: string;
  userId: string;
  role: 'editor';
  invitedBy: string | null;
  createdAt: string;
}

export interface CanAddInput {
  actorUserId: string;
  nodeCreatedBy: string;
  workspaceAllowMemberCrossPublish: boolean;
}

export type CanAddResult =
  | { ok: true }
  | { ok: false; reason: 'cross_publish_disabled' };

export function canAddCaptureToCollection(input: CanAddInput): CanAddResult {
  if (input.actorUserId === input.nodeCreatedBy) return { ok: true };
  if (input.workspaceAllowMemberCrossPublish) return { ok: true };
  return { ok: false, reason: 'cross_publish_disabled' };
}
