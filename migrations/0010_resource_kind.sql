-- What a resource is, worked out from its address (doc, sheet, slides, form, drawing, folder,
-- file, pdf, image, link, phone, email, text). Drives the icon. Filled in by the app.
ALTER TABLE resources ADD COLUMN kind TEXT;
