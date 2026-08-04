import { Router } from "express";

export const commentaryRouter = Router();

commentaryRouter.get('/', (req, res) => {
  res.status(200).json({ message: 'Commentary list' });
})
