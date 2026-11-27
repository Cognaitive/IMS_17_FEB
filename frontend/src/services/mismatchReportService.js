import api from './api'

export const getMismatchReports = async (params = {}) => {
  const response = await api.get('/mismatch-reports', { params })
  return response.data
}

export const getMismatchReport = async (id) => {
  const response = await api.get(`/mismatch-reports/${id}`)
  return response.data
}

export const applyMismatchReport = async (id) => {
  const response = await api.post(`/mismatch-reports/${id}/apply`)
  return response.data
}
