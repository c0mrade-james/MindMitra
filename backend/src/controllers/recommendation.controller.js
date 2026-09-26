const { StatusCodes } = require('http-status-codes');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { getStudentRecommendations } = require('../services/recommendation.service');

const getMyRecommendations = asyncHandler(async (req, res) => {
  const recommendations = await getStudentRecommendations(req.user._id);
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, recommendations, 'Recommendations fetched'));
});

module.exports = { getMyRecommendations };
