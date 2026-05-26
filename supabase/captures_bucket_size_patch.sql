-- Allow larger direct-to-storage uploads (the 'captures' bucket may default
-- below the file size of large PDFs). 50 MB ceiling.
update storage.buckets
set file_size_limit = 52428800
where id = 'captures';
