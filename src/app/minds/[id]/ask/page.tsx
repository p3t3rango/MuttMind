'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
export default function AskRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => { router.replace(`/minds/${id}/insights`); }, [id, router]);
  return null;
}
