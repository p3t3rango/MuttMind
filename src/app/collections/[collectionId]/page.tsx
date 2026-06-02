import CollectionEditor from './CollectionEditor';

export default async function CollectionEditorPage({
  params,
}: { params: Promise<{ collectionId: string }> }) {
  const { collectionId } = await params;
  return <CollectionEditor collectionId={collectionId} />;
}
