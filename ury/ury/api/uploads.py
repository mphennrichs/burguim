# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Staff-facing image upload — used by the logo (branding.py) and menu item
# photo (MenuPage.tsx) flows. Deliberately NOT a thin wrapper around
# Frappe's generic /api/method/upload_file: that endpoint accepts and
# serves any file type inline, including SVG with an embedded <script> —
# a confirmed stored-XSS vector (any staff role, not just managers, can
# create a File). This endpoint only ever persists a real raster image,
# verified by actually decoding it, not by trusting the filename/
# Content-Type the client sent.

import io

import frappe
from frappe import _
from frappe.utils.file_manager import save_file
from PIL import Image, UnidentifiedImageError

MAX_IMAGE_BYTES = 5 * 1024 * 1024  # matches the 5MB the upload UI advertises
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP"}


@frappe.whitelist(methods=["POST"])
def upload_image():
    files = frappe.request.files
    if "file" not in files:
        frappe.throw(_("No file was uploaded"))

    upload = files["file"]
    content = upload.stream.read()
    filename = upload.filename or "image"

    if len(content) > MAX_IMAGE_BYTES:
        frappe.throw(_("Image must be under 5MB"))

    # The only check that actually matters: decode the bytes as a real
    # image. This is what rejects SVG (Pillow has no SVG decoder) and any
    # non-image file wearing a .jpg/.png extension — the exact case that,
    # left to Frappe's own image-processing path, surfaced a raw Python
    # traceback to the caller instead of a clean error.
    try:
        image = Image.open(io.BytesIO(content))
        image.verify()
        # verify() leaves the file object unusable for anything further —
        # a fresh open is required to actually decode pixel data afterward.
        image = Image.open(io.BytesIO(content))
        image_format = image.format
        image.load()
    except Exception:
        # Deliberately catches everything, not just the handful of Pillow
        # exception types this was originally written against: a security
        # re-test found a 69-byte PNG declaring 40000x40000 pixel
        # dimensions raises Image.DecompressionBombError, which is neither
        # UnidentifiedImageError, OSError nor ValueError — that one slipped
        # past the narrower catch and surfaced a raw Python traceback
        # (server file paths, Pillow version) to any authenticated staff
        # caller instead of the clean error this endpoint exists to
        # guarantee. Nothing after this point in the file should ever
        # legitimately raise, so broadening the catch here doesn't hide
        # anything else.
        frappe.throw(_("Invalid image file"))

    if image_format not in ALLOWED_FORMATS:
        frappe.throw(_("Only PNG, JPEG or WEBP images are allowed"))

    # Re-encode from the decoded pixel data rather than persisting the
    # original bytes: a security re-test found a PNG with a valid header
    # and arbitrary bytes appended after IEND sails through the checks
    # above unchanged (Pillow decodes the real image and ignores trailing
    # garbage) and would otherwise be saved and served byte-for-byte,
    # trailing payload included. Re-saving through Pillow only ever
    # writes what it actually decoded, so nothing appended past the real
    # image data survives.
    buffer = io.BytesIO()
    image.save(buffer, format=image_format)
    clean_content = buffer.getvalue()

    file_doc = save_file(filename, clean_content, None, None, is_private=0)
    return {"file_url": file_doc.file_url}
