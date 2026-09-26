const express = require('express');
const controller = require('../controllers/recommendation.controller');
const verifyJWT = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/role.middleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();
router.use(verifyJWT);

router.get('/my', authorizeRoles(ROLES.STUDENT), controller.getMyRecommendations);

module.exports = router;
