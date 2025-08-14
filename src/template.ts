export interface ImageTemplateInput {
  // Mô tả yêu cầu ảnh gốc của người dùng
  prompt: string;
  // Tuỳ chọn kích thước
  width?: number;
  height?: number;
  // Phong cách (ví dụ: photorealistic, watercolor, cyberpunk...)
  style?: string;
}

// Chuẩn hoá prompt theo phong cách/mẫu đề xuất của Google để mô hình bám sát yêu cầu hơn
export function buildGoogleImagePrompt(input: ImageTemplateInput): string {
  const { prompt, width, height, style } = input;

  const sections: string[] = [];

  // Bối cảnh/ngữ cảnh cho mô hình
  sections.push(
    'Bạn là mô hình tạo ảnh. Hãy tạo ảnh bám sát mô tả, tránh thêm chi tiết không được yêu cầu.'
  );

  // Yêu cầu chính
  sections.push(`Mô tả ảnh chi tiết: ${prompt.trim()}`);

  // Phong cách nếu có
  if (style) {
    sections.push(`Phong cách/Style: ${style}`);
  }

  // Kích thước nếu có
  if (width && height) {
    sections.push(`Kích thước mong muốn: ${width}x${height} px`);
  }

  // Các ràng buộc/chất lượng
  sections.push(
    [
      'Ràng buộc chất lượng:',
      '- Thành phần chính phải nổi bật, bố cục rõ ràng.',
      '- Ánh sáng/phối màu hài hoà; tránh nhiễu/artefacts.',
      '- Tránh text/branding không được yêu cầu trên ảnh.',
      '- Trung thành với mô tả; không thêm đối tượng không nêu.',
    ].join('\n')
  );

  // Đầu ra
  sections.push('Đầu ra: Ảnh duy nhất đúng mô tả.');

  return sections.join('\n\n');
} 