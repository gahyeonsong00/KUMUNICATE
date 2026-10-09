-- =====================================================================
-- 첨부 파일 저장소(Storage 버킷 complaint-files)
--
-- - 비공개 버킷. 파일 하나 최대 10MB
-- - 사진: jpg, png, webp, heic / 문서: pdf, hwp, hwpx, docx (동영상은 받지 않음)
-- - 업로드 경로는 반드시 "{본인 user id}/{아무 이름}" (예: 3f2a.../a1b2.jpg)
-- - 읽기: 본인 파일, 또는 내가 볼 수 있는 민원에 첨부된 파일(= 담당자)
-- - 개수 제한(사진 3, 문서 2)은 complaints 테이블에서 강제한다
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'complaint-files', 'complaint-files', false, 10 * 1024 * 1024,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'application/pdf',
    'application/x-hwp', 'application/haansofthwp', 'application/vnd.hancom.hwp',
    'application/vnd.hancom.hwpx', 'application/hwp+zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
);

create policy "본인 폴더에 업로드" on storage.objects for insert to authenticated
  with check (bucket_id = 'complaint-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "본인 파일 또는 볼 수 있는 민원의 첨부 읽기" on storage.objects for select to authenticated
  using (
    bucket_id = 'complaint-files'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (select 1 from public.complaints c
                 where name = any (c.photo_paths) or name = any (c.doc_paths))
    )
  );

-- 접수 전에 잘못 올린 파일, 수정하면서 뺀 파일을 지울 수 있게
create policy "본인 파일 삭제" on storage.objects for delete to authenticated
  using (bucket_id = 'complaint-files' and (storage.foldername(name))[1] = auth.uid()::text);
