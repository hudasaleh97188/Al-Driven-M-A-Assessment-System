import os
import tempfile
import win32com.client
from loguru import logger

def convert_to_pdf(input_path: str, output_dir: str) -> str:
    """
    Given a file path (Excel, PPT, Word, or PDF), it returns the path to a PDF version.
    If it's already a PDF, returns the original path.
    Otherwise, uses win32com to convert it to a PDF and saves it in output_dir.
    """
    ext = os.path.splitext(input_path)[1].lower()
    
    if ext == ".pdf":
        return input_path
        
    filename = os.path.basename(input_path)
    base_name = os.path.splitext(filename)[0]
    output_pdf = os.path.join(output_dir, f"{base_name}.pdf")
    
    input_path_abs = os.path.abspath(input_path)
    output_pdf_abs = os.path.abspath(output_pdf)

    try:
        if ext in [".xls", ".xlsx"]:
            logger.info(f"Converting Excel file to PDF: {filename}")
            excel = win32com.client.DispatchEx("Excel.Application")
            excel.Visible = False
            excel.DisplayAlerts = False
            try:
                wb = excel.Workbooks.Open(input_path_abs)
                wb.ExportAsFixedFormat(0, output_pdf_abs)
                wb.Close(False)
            finally:
                excel.Quit()
                
        elif ext in [".ppt", ".pptx"]:
            logger.info(f"Converting PowerPoint file to PDF: {filename}")
            powerpoint = win32com.client.DispatchEx("Powerpoint.Application")
            # For PowerPoint, opening invisible is tricky in some versions, but we do our best
            try:
                presentation = powerpoint.Presentations.Open(input_path_abs, WithWindow=False)
                presentation.SaveAs(output_pdf_abs, 32) # 32 is the enum for PDF
                presentation.Close()
            finally:
                powerpoint.Quit()
                
        elif ext in [".doc", ".docx"]:
            logger.info(f"Converting Word file to PDF: {filename}")
            word = win32com.client.DispatchEx("Word.Application")
            word.Visible = False
            try:
                doc = word.Documents.Open(input_path_abs)
                doc.SaveAs(output_pdf_abs, FileFormat=17) # 17 is the enum for PDF
                doc.Close()
            finally:
                word.Quit()
        else:
            logger.warning(f"Unsupported file format for conversion: {ext}. Returning original path.")
            return input_path
            
    except Exception as e:
        logger.error(f"Failed to convert {filename} to PDF: {e}")
        # If conversion fails, we return the original path and hope the LLM can handle the raw text or the pipeline catches it
        return input_path

    logger.info(f"Successfully converted {filename} to {output_pdf_abs}")
    return output_pdf_abs
