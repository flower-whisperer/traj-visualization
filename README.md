# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## TimeLine

### 0813

实现了精细化地球，使用的是cesiumJS

初步的展示打算是从3D地球聚焦到具体海域，然后进行轨迹预测展示

![1755164587636](image/README/1755164587636.png)

### 0814

把渔船模型加载进来，并给出了轨迹可视化的初步方案

问题：海水太暗，渔船太小看不清，渔船太大覆盖轨迹太多，轨迹太短

![1755164555381](image/README/1755164555381.png)
