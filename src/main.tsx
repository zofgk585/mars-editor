import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// 不使用 StrictMode：其双挂载会让 CodeMirror 实例（含 scroll 监听、viewRef）
// 经历一次「创建→销毁→重建」，引入竞态（旧 view 的 dispatch 失效）。
// 本应用无需要 StrictMode 的副作用检查收益。
createRoot(document.getElementById('root')!).render(<App />);
