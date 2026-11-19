import { useTabs } from '../state';
import { renderDashboard } from './dashboard';
import { renderExport, renderStudentExport } from './export';

/** 6단계: 작성 내용 확인(작업별 현황) 및 출력 */
export async function renderReview(el: HTMLElement) {
  const tab = useTabs([
    { id: 'status', label: '작성 현황' },
    { id: 'export', label: '작업별 출력' },
    { id: 'student', label: '학생별 출력' },
  ]);
  if (tab === 'status') await renderDashboard(el);
  else if (tab === 'student') await renderStudentExport(el);
  else await renderExport(el);
}
